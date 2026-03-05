import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWhoopDayData, refreshWhoopToken } from "@/lib/wearables/whoop";
import { calculateBehavioralRisk } from "@/lib/insights/calculate-risk";

async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data: conn, error } = await supabase
    .from("whoop_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) throw new Error("No Whoop connection found for this user");

  // Refresh proactively if the token expires within 5 minutes
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

async function syncOneDay(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  userId: string,
  syncDate: string,
): Promise<{ date: string; risk_score: number | null; skipped?: boolean }> {
  const snapshot = await fetchWhoopDayData(accessToken, syncDate);

  // If Whoop returned no data at all for this day, skip silently
  if (
    snapshot.sleep_hours === null &&
    snapshot.hrv_avg === null &&
    snapshot.active_energy === null
  ) {
    return { date: syncDate, risk_score: null, skipped: true };
  }

  await supabase
    .from("health_data")
    .upsert(
      {
        user_id:              userId,
        date:                 snapshot.date,
        sleep_hours:          snapshot.sleep_hours,
        sleep_quality:        snapshot.sleep_quality,
        hrv_avg:              snapshot.hrv_avg,
        stress_level:         snapshot.stress_level,
        active_energy:        snapshot.active_energy,
        workout_minutes:      snapshot.workout_minutes,
        source_device:        snapshot.source_device,
        whoop_recovery_score: snapshot.whoop_recovery_score,
        whoop_strain:         snapshot.whoop_strain,
        whoop_sleep_score:    snapshot.whoop_sleep_score,
      },
      { onConflict: "user_id,date", ignoreDuplicates: false },
    );

  const riskResult = await calculateBehavioralRisk(supabase, userId, syncDate);
  if (riskResult) {
    await supabase
      .from("behavioral_insights")
      .upsert(
        {
          user_id:          userId,
          date:             syncDate,
          risk_score:       riskResult.risk_score,
          insights:         riskResult.insights,
          health_summary:   riskResult.health_summary,
          spending_summary: riskResult.spending_summary,
        },
        { onConflict: "user_id,date", ignoreDuplicates: false },
      );
  }

  return { date: syncDate, risk_score: riskResult?.risk_score ?? null };
}

export async function POST(request: Request) {
  try {
    const body   = await request.json();
    const userId = body.user_id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const supabase    = createClient();
    const accessToken = await getValidAccessToken(supabase, userId);

    // ── Multi-day backfill mode ───────────────────────────────────────────────
    // Pass `days: N` to sync the last N days (e.g. days: 30)
    const days = typeof body.days === "number" ? body.days : null;

    if (days && days > 1) {
      const results = [];
      let synced = 0;

      for (let i = 1; i <= days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];

        try {
          const result = await syncOneDay(supabase, accessToken, userId, dateStr);
          if (!result.skipped) synced++;
          results.push(result);
        } catch (dayErr) {
          console.warn(`[whoop/sync] Skipped ${dateStr}:`, dayErr);
          results.push({ date: dateStr, risk_score: null, skipped: true });
        }
      }

      return NextResponse.json({ success: true, days_synced: synced, results });
    }

    // ── Single-day mode ───────────────────────────────────────────────────────
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const syncDate: string = body.date ?? yesterday.toISOString().split("T")[0];

    const result = await syncOneDay(supabase, accessToken, userId, syncDate);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Whoop sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
