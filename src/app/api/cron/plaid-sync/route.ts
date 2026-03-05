import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * GET /api/cron/plaid-sync
 *
 * Runs daily at 09:00 UTC via Vercel Cron.
 * Runs an incremental transactionsSync for every connected Plaid item,
 * picking up any new transactions since the last cursor.
 *
 * This is also the safety net for HISTORICAL_UPDATE_COMPLETE — if the
 * webhook failed to fire or the initial backfill missed data, this cron
 * will catch it within 24 hours.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase  = createClient();
  const appUrl    = (process.env.NEXT_PUBLIC_APP_URL ?? "https://spine-one.vercel.app").replace(/\/$/, "");

  // Find all users who have a Plaid item
  const { data: items, error } = await supabase
    .from("plaid_items")
    .select("user_id")
    .order("created_at", { ascending: true });

  if (error || !items?.length) {
    console.log("[cron/plaid-sync] No Plaid items found.");
    return NextResponse.json({ synced: 0 });
  }

  // Deduplicate user IDs (one user could theoretically have multiple items)
  const userIds = [...new Set(items.map(i => i.user_id as string))];
  console.log(`[cron/plaid-sync] Syncing ${userIds.length} user(s)…`);

  let synced = 0;
  for (const userId of userIds) {
    try {
      const res = await fetch(`${appUrl}/api/plaid/sync-transactions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, force_resync: false }),
      });
      if (res.ok) {
        const data = await res.json() as { transactions_added?: number };
        console.log(`[cron/plaid-sync] ✓ ${userId} — +${data.transactions_added ?? 0} new`);
        synced++;
      } else {
        console.error(`[cron/plaid-sync] ✗ ${userId} — ${res.status}`);
      }
    } catch (e) {
      console.error(`[cron/plaid-sync] ✗ ${userId} —`, e);
    }
  }

  console.log(`[cron/plaid-sync] Done — ${synced}/${userIds.length} synced`);
  return NextResponse.json({ synced, total: userIds.length });
}
