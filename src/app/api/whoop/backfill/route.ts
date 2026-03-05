import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWhoopDayData, refreshWhoopToken } from "@/lib/wearables/whoop";
import { format, subDays } from "date-fns";

/**
 * POST /api/whoop/backfill
 *
 * Uses the same fetchWhoopDayData function that works for the daily sync,
 * running it across all historical dates in parallel batches of 20.
 * This guarantees recovery + sleep + strain all align correctly per day.
 *
 * Body: { user_id: string, days?: number (default 730 = 2 years) }
 */
export async function POST(request: Request) {
  try {
    const body   = await request.json();
    const userId = body.user_id as string | undefined;
    if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const days = typeof body.days === "number" ? body.days : 730;

    const supabase = createClient();

    // Get + refresh token
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

    // Build date list oldest→newest (skip today since it's incomplete)
    const dates: string[] = [];
    for (let i = days; i >= 1; i--) {
      dates.push(format(subDays(new Date(), i), "yyyy-MM-dd"));
    }

    console.log(`[whoop/backfill] Syncing ${dates.length} days for user ${userId}`);

    const BATCH = 20;
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const errorDates: string[] = [];

    for (let i = 0; i < dates.length; i += BATCH) {
      const batch = dates.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map(async (date) => {
          const snapshot = await fetchWhoopDayData(accessToken, date);

          // Skip days where Whoop returned nothing at all
          if (
            snapshot.sleep_hours          === null &&
            snapshot.hrv_avg              === null &&
            snapshot.whoop_recovery_score === null &&
            snapshot.whoop_strain         === null
          ) {
            return { date, status: "skipped" as const };
          }

          const { error } = await supabase.from("health_data").upsert(
            {
              user_id:              userId,
              date:                 snapshot.date,
              sleep_hours:          snapshot.sleep_hours,
              sleep_quality:        snapshot.sleep_quality,
              hrv_avg:              snapshot.hrv_avg,
              resting_heart_rate:   snapshot.resting_heart_rate,
              stress_level:         snapshot.stress_level,
              active_energy:        snapshot.active_energy,
              whoop_calories:       snapshot.whoop_calories,
              whoop_rem_mins:       snapshot.whoop_rem_mins,
              whoop_deep_mins:      snapshot.whoop_deep_mins,
              whoop_light_mins:     snapshot.whoop_light_mins,
              workout_minutes:      snapshot.workout_minutes,
              source_device:        snapshot.source_device,
              whoop_recovery_score: snapshot.whoop_recovery_score,
              whoop_strain:         snapshot.whoop_strain,
              whoop_sleep_score:    snapshot.whoop_sleep_score,
            },
            { onConflict: "user_id,date", ignoreDuplicates: false },
          );

          if (error) {
            console.error(`[whoop/backfill] DB error for ${date}:`, error.message);
            return { date, status: "error" as const, message: error.message };
          }

          return { date, status: "ok" as const };
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value.status === "ok")      synced++;
          else if (r.value.status === "skipped") skipped++;
          else { errors++; errorDates.push(r.value.date); }
        } else {
          errors++;
          console.error(`[whoop/backfill] Promise rejected:`, r.reason);
        }
      }
    }

    console.log(`[whoop/backfill] Done — synced=${synced} skipped=${skipped} errors=${errors}`);

    return NextResponse.json({
      success:    true,
      days_range: days,
      synced,
      skipped,
      errors,
      error_dates: errorDates.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whoop/backfill] Fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
