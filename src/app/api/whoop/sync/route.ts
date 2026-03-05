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

export async function POST(request: Request) {
  try {
    const body    = await request.json();
    const userId  = body.user_id as string | undefined;

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    // Default to yesterday if no date provided
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const syncDate: string = body.date ?? yesterday.toISOString().split("T")[0];

    const supabase     = createClient();
    const accessToken  = await getValidAccessToken(supabase, userId);
    const snapshot     = await fetchWhoopDayData(accessToken, syncDate);

    const { error: upsertError } = await supabase
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

    if (upsertError) {
      console.error("Whoop sync DB error:", upsertError);
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Recalculate behavioral risk for the synced date
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

    return NextResponse.json({
      success:    true,
      date:       syncDate,
      data:       snapshot,
      risk_score: riskResult?.risk_score ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Whoop sync error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
