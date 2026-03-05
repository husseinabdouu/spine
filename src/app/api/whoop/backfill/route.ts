import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshWhoopToken } from "@/lib/wearables/whoop";

const WHOOP_BASE = "https://api.prod.whoop.com/developer/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhoopPage<T> {
  records:    T[];
  next_token?: string | null;
}

interface WhoopRecoveryRecord {
  created_at:  string;
  score_state: string;
  score: {
    recovery_score:     number;
    hrv_rmssd_milli:    number;
    resting_heart_rate: number;
  } | null;
}

interface WhoopSleepRecord {
  start:       string;
  nap:         boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli:  number;
      total_awake_time_milli:   number;
      total_no_data_time_milli: number;
    };
    sleep_performance_percentage: number;
  } | null;
}

interface WhoopCycleRecord {
  start:       string;
  score_state: string;
  score: {
    strain:    number;
    kilojoule: number;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function sleepQuality(score: number | null): "poor" | "fair" | "good" {
  if (score === null) return "fair";
  if (score >= 70)    return "good";
  if (score >= 50)    return "fair";
  return "poor";
}

function stressLevel(hrv: number | null): "low" | "medium" | "high" {
  if (hrv === null) return "medium";
  if (hrv >= 65)    return "low";
  if (hrv >= 50)    return "medium";
  return "high";
}

async function fetchAllPages<T>(
  path: string,
  accessToken: string,
  startDate: string,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const params = new URLSearchParams({
      start: `${startDate}T00:00:00.000Z`,
      limit: "25",
    });
    if (nextToken) params.set("nextToken", nextToken);

    const res = await fetch(`${WHOOP_BASE}${path}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.warn(`[whoop/backfill] ${path} returned ${res.status}`);
      break;
    }

    const page = (await res.json()) as WhoopPage<T>;
    all.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);

  return all;
}

async function getValidToken(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data: conn, error } = await supabase
    .from("whoop_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) throw new Error("No Whoop connection found");

  const expiresAt = new Date(conn.expires_at as string).getTime();
  if (expiresAt <= Date.now() + 5 * 60 * 1000) {
    const refreshed  = await refreshWhoopToken(conn.refresh_token as string);
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabase
      .from("whoop_connections")
      .update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at:    newExpires,
        updated_at:    new Date().toISOString(),
      })
      .eq("user_id", userId);
    return refreshed.access_token;
  }

  return conn.access_token as string;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body   = await request.json();
    const userId = body.user_id as string | undefined;
    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    // Go back to Whoop's earliest supported date by default
    const startDate: string = body.start_date ?? "2020-01-01";

    const supabase    = createClient();
    const accessToken = await getValidToken(supabase, userId);

    console.log(`[whoop/backfill] Fetching all records since ${startDate}…`);

    // ── Fetch all three collections in parallel ────────────────────────────────
    const [recoveryRecords, sleepRecords, cycleRecords] = await Promise.all([
      fetchAllPages<WhoopRecoveryRecord>("/recovery",        accessToken, startDate),
      fetchAllPages<WhoopSleepRecord>   ("/activity/sleep",  accessToken, startDate),
      fetchAllPages<WhoopCycleRecord>   ("/cycle",           accessToken, startDate),
    ]);

    console.log(
      `[whoop/backfill] Fetched: ${recoveryRecords.length} recovery, ` +
      `${sleepRecords.length} sleep, ${cycleRecords.length} cycle records`,
    );

    // ── Index by date ──────────────────────────────────────────────────────────
    const recoveryByDate = new Map<string, WhoopRecoveryRecord>();
    for (const r of recoveryRecords) {
      if (r.score_state === "SCORED" && r.score) {
        recoveryByDate.set(toDate(r.created_at), r);
      }
    }

    // Prefer non-nap sleep records; only use nap if it's the only record for that date
    const sleepByDate = new Map<string, WhoopSleepRecord>();
    for (const s of sleepRecords) {
      if (s.score_state !== "SCORED" || !s.score) continue;
      const d = toDate(s.start);
      const existing = sleepByDate.get(d);
      if (!existing || (!s.nap && existing.nap)) {
        sleepByDate.set(d, s);
      }
    }

    const cycleByDate = new Map<string, WhoopCycleRecord>();
    for (const c of cycleRecords) {
      if (c.score_state === "SCORED" && c.score) {
        cycleByDate.set(toDate(c.start), c);
      }
    }

    // ── Build upsert rows from the union of all dates ──────────────────────────
    const allDates = new Set([
      ...recoveryByDate.keys(),
      ...sleepByDate.keys(),
      ...cycleByDate.keys(),
    ]);

    const rows = [];
    for (const date of allDates) {
      const rec   = recoveryByDate.get(date) ?? null;
      const sleep = sleepByDate.get(date)    ?? null;
      const cycle = cycleByDate.get(date)    ?? null;

      const hrv           = rec?.score?.hrv_rmssd_milli ?? null;
      const recoveryScore = rec?.score?.recovery_score  ?? null;

      let sleepHours: number | null = null;
      if (sleep?.score?.stage_summary) {
        const s = sleep.score.stage_summary;
        const asleepMs = Math.max(
          0,
          s.total_in_bed_time_milli -
          s.total_awake_time_milli -
          s.total_no_data_time_milli,
        );
        sleepHours = Math.round((asleepMs / 3_600_000) * 10) / 10;
      }
      const sleepScore = sleep?.score?.sleep_performance_percentage ?? null;

      const strain       = cycle?.score?.strain ?? null;
      const activeEnergy = strain !== null ? Math.round(strain * 500) : null;

      rows.push({
        user_id:              userId,
        date,
        sleep_hours:          sleepHours,
        sleep_quality:        sleepQuality(sleepScore),
        hrv_avg:              hrv !== null ? Math.round(hrv) : null,
        stress_level:         stressLevel(hrv),
        active_energy:        activeEnergy,
        workout_minutes:      null,
        source_device:        "whoop",
        whoop_recovery_score: recoveryScore,
        whoop_strain:         strain !== null ? Math.round(strain * 10) / 10 : null,
        whoop_sleep_score:    sleepScore,
      });
    }

    // ── Bulk upsert in batches of 100 ─────────────────────────────────────────
    const BATCH = 100;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("health_data")
        .upsert(batch, { onConflict: "user_id,date", ignoreDuplicates: false });
      if (error) console.error(`[whoop/backfill] Upsert error at batch ${i}:`, error);
      else upserted += batch.length;
    }

    console.log(`[whoop/backfill] Done — upserted ${upserted} days`);

    return NextResponse.json({
      success:       true,
      days_upserted: upserted,
      records: {
        recovery: recoveryRecords.length,
        sleep:    sleepRecords.length,
        cycle:    cycleRecords.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whoop/backfill] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
