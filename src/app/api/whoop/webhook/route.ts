import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Event types that carry new health data worth syncing
const SYNC_EVENTS = new Set([
  "recovery.updated",
  "sleep.updated",
  "cycle.updated",
  "workout.updated",
]);

interface WhoopWebhookPayload {
  event_type: string;
  user_id:    number;
  created_at: string;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as WhoopWebhookPayload;
    const { event_type, user_id: whoopUserId } = payload;

    // Acknowledge immediately — Whoop expects a 2xx quickly
    if (!SYNC_EVENTS.has(event_type)) {
      return NextResponse.json({ received: true });
    }

    const supabase = createClient();

    // Resolve the Spine user from the Whoop user ID
    const { data: conn } = await supabase
      .from("whoop_connections")
      .select("user_id")
      .eq("whoop_user_id", whoopUserId)
      .single();

    if (!conn) {
      return NextResponse.json({ received: true, note: "unknown whoop user" });
    }

    // Trigger sync for yesterday (Whoop nightly data completes after midnight)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://spine-one.vercel.app";

    // Fire-and-forget — don't hold up the webhook response
    fetch(`${appUrl}/api/whoop/sync`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ user_id: conn.user_id, date: dateStr }),
    }).catch((err) => console.error("Whoop webhook → sync error:", err));

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Whoop webhook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
