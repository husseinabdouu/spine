import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshWhoopToken } from "@/lib/wearables/whoop";
import { subDays } from "date-fns";

const BASE = "https://api.prod.whoop.com/developer/v2";

// ─── Types ────────────────────────────────────────────────────────────────────

type CycleRecord = {
  id: number;
  start: string;
  end: string | null;
  timezone_offset: string;
  score_state: string;
  score: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number } | null;
};

type RecoveryRecord = {
  cycle_id: number;
  score_state: string;
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage: number | null;
    skin_temp_celsius: number | null;
  } | null;
};

type SleepRecord = {
  id: string;
  cycle_id: number;
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
    };
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Paginate through a Whoop v2 collection endpoint, fetching all records
 * from `cutoff` onwards. Returns an array of all records.
 */
async function fetchAllPages<T>(
  path: string,
  token: string,
  cutoff: string,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null = null;

  do {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("limit", "25");
    url.searchParams.set("start", cutoff);
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { records: T[]; next_token?: string | null };
    all.push(...data.records);
    nextToken = data.next_token ?? null;
  } while (nextToken);

  return all;
}

/**
 * Derive the user's local calendar date from the cycle's UTC start
 * and the timezone_offset stored in the cycle (e.g. "-05:00").
 */
function cycleLocalDate(startUtc: string, timezoneOffset: string): string {
  const utcMs = new Date(startUtc).getTime();
  const sign = timezoneOffset.startsWith("-") ? -1 : 1;
  const [hStr, mStr] = timezoneOffset.replace(/^[+-]/, "").split(":");
  const offsetMs = sign * (parseInt(hStr, 10) * 60 + parseInt(mStr, 10)) * 60_000;
  const localMs = utcMs + offsetMs;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/whoop/backfill
 *
 * Fetches ALL historical cycles, recoveries, and sleeps in 3 paginated
 * API calls (instead of 730 individual date queries). Joins them by
 * cycle_id — which is exactly how Whoop structures its data — so
 * recovery HRV/RHR/score and sleep stages are always correctly linked
 * regardless of UTC vs local timezone date boundaries.
 *
 * Body: { user_id: string, days?: number (default 730) }
 */
export async function POST(request: Request) {
  try {
    const body   = await request.json();
    const userId = body.user_id as string | undefined;
    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const days = typeof body.days === "number" ? body.days : 730;

    const supabase = createClient();

    // ── Token ──────────────────────────────────────────────────────────────
    const { data: conn, error: connErr } = await supabase
      .from("whoop_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .single();

    if (connErr || !conn) {
      return NextResponse.json({ error: "No Whoop connection found" }, { status: 404 });
    }

    let accessToken = conn.access_token as string;
    const expiresAt = new Date(conn.expires_at as string).getTime();

    if (expiresAt <= Date.now() + 5 * 60 * 1000) {
      const refreshed  = await refreshWhoopToken(conn.refresh_token as string);
      const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase.from("whoop_connections").update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at:    newExpires,
        updated_at:    new Date().toISOString(),
      }).eq("user_id", userId);
      accessToken = refreshed.access_token;
    }

    // ── Fetch all data (3 paginated calls) ─────────────────────────────────
    const cutoff = subDays(new Date(), days).toISOString();
    console.log(`[whoop/backfill] Fetching all data since ${cutoff} for user ${userId}`);

    const [cycles, recoveries, sleeps] = await Promise.all([
      fetchAllPages<CycleRecord>   ("/cycle",          accessToken, cutoff),
      fetchAllPages<RecoveryRecord>("/recovery",       accessToken, cutoff),
      fetchAllPages<SleepRecord>   ("/activity/sleep", accessToken, cutoff),
    ]);

    console.log(`[whoop/backfill] Fetched: ${cycles.length} cycles, ${recoveries.length} recoveries, ${sleeps.length} sleeps`);

    // ── Build lookup maps (cycle_id → best recovery / best sleep) ──────────
    const recoveryByCycle = new Map<number, RecoveryRecord>();
    for (const r of recoveries) {
      const existing = recoveryByCycle.get(r.cycle_id);
      if (!existing || (r.score_state === "SCORED" && existing.score_state !== "SCORED")) {
        recoveryByCycle.set(r.cycle_id, r);
      }
    }

    const sleepByCycle = new Map<number, SleepRecord>();
    for (const s of sleeps) {
      if (s.nap) continue;
      const existing = sleepByCycle.get(s.cycle_id);
      if (!existing || (s.score_state === "SCORED" && existing.score_state !== "SCORED")) {
        sleepByCycle.set(s.cycle_id, s);
      }
    }

    // ── One snapshot per local calendar date ───────────────────────────────
    const byDate = new Map<string, { cycle: CycleRecord; recovery?: RecoveryRecord; sleep?: SleepRecord }>();

    for (const cycle of cycles) {
      const localDate = cycleLocalDate(cycle.start, cycle.timezone_offset ?? "-05:00");
      const existing  = byDate.get(localDate);
      if (!existing || cycle.score_state === "SCORED") {
        byDate.set(localDate, {
          cycle,
          recovery: recoveryByCycle.get(cycle.id),
          sleep:    sleepByCycle.get(cycle.id),
        });
      }
    }

    console.log(`[whoop/backfill] Unique local dates: ${byDate.size}`);

    // ── Build DB rows ──────────────────────────────────────────────────────
    const rows: Record<string, unknown>[] = [];

    for (const [date, { cycle, recovery, sleep }] of byDate.entries()) {
      const strain   = cycle.score?.strain    ?? null;
      const kj       = cycle.score?.kilojoule ?? null;
      const calories = kj !== null ? Math.round(kj * 0.239) : null;

      const recoveryScore = recovery?.score?.recovery_score     ?? null;
      const hrv           = recovery?.score?.hrv_rmssd_milli    ?? null;
      const rhr           = recovery?.score?.resting_heart_rate ?? null;

      let sleepHours: number | null = null;
      let remMins: number | null    = null;
      let deepMins: number | null   = null;
      let lightMins: number | null  = null;
      let sleepScore: number | null = null;

      if (sleep?.score?.stage_summary) {
        const s = sleep.score.stage_summary;
        const asleepMs = Math.max(0,
          s.total_in_bed_time_milli -
          s.total_awake_time_milli  -
          s.total_no_data_time_milli,
        );
        sleepHours = Math.round(asleepMs / 3_600_000 * 10) / 10;
        remMins    = Math.round(s.total_rem_sleep_time_milli       / 60_000);
        deepMins   = Math.round(s.total_slow_wave_sleep_time_milli / 60_000);
        lightMins  = Math.round(s.total_light_sleep_time_milli     / 60_000);
        sleepScore = sleep.score.sleep_performance_percentage ?? null;
      }

      // Skip days with no data at all
      if (sleepHours === null && hrv === null && recoveryScore === null && strain === null) continue;

      const sleepQuality: "poor" | "fair" | "good" =
        sleepScore === null ? "fair" : sleepScore >= 70 ? "good" : sleepScore >= 50 ? "fair" : "poor";

      const stressLevel: "low" | "medium" | "high" =
        hrv === null ? "medium" : hrv >= 65 ? "low" : hrv >= 50 ? "medium" : "high";

      rows.push({
        user_id:              userId,
        date,
        sleep_hours:          sleepHours,
        sleep_quality:        sleepQuality,
        hrv_avg:              hrv !== null ? Math.round(hrv) : null,
        resting_heart_rate:   rhr !== null ? Math.round(rhr) : null,
        stress_level:         stressLevel,
        active_energy:        strain !== null ? Math.round(strain * 500) : null,
        whoop_calories:       calories,
        whoop_rem_mins:       remMins,
        whoop_deep_mins:      deepMins,
        whoop_light_mins:     lightMins,
        workout_minutes:      null,
        source_device:        "whoop",
        whoop_recovery_score: recoveryScore,
        whoop_strain:         strain !== null ? Math.round(strain * 10) / 10 : null,
        whoop_sleep_score:    sleepScore,
      });
    }

    // ── Upsert in batches of 50 ────────────────────────────────────────────
    const BATCH = 50;
    let synced = 0;
    let errors = 0;
    const errorDates: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error: dbErr } = await supabase
        .from("health_data")
        .upsert(batch, { onConflict: "user_id,date", ignoreDuplicates: false });

      if (dbErr) {
        errors += batch.length;
        errorDates.push(...batch.slice(0, 2).map(r => String(r.date)));
        console.error("[whoop/backfill] DB batch error:", dbErr.message);
      } else {
        synced += batch.length;
      }
    }

    const skipped = byDate.size - rows.length;
    console.log(`[whoop/backfill] Done — synced=${synced} skipped=${skipped} errors=${errors}`);

    return NextResponse.json({
      success:          true,
      days_range:       days,
      raw_cycles:       cycles.length,
      raw_recoveries:   recoveries.length,
      raw_sleeps:       sleeps.length,
      unique_dates:     byDate.size,
      synced,
      skipped,
      errors,
      error_dates:      errorDates.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whoop/backfill] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
