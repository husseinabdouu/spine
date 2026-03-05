import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshWhoopToken } from "@/lib/wearables/whoop";

/**
 * GET /api/cron/whoop-sync
 *
 * Runs daily at 08:00 UTC (3–4 AM ET) via Vercel Cron.
 * Syncs yesterday's Whoop data for every connected user so health data
 * is always up to date without any manual action.
 *
 * Secured by CRON_SECRET — Vercel sets this automatically and passes it
 * as Authorization: Bearer <secret> on every cron invocation.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();
  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? "https://spine-one.vercel.app").replace(/\/$/, "");

  // Fetch all Whoop connections
  const { data: connections, error } = await supabase
    .from("whoop_connections")
    .select("user_id, access_token, refresh_token, expires_at");

  if (error || !connections?.length) {
    console.log("[cron/whoop-sync] No Whoop connections found.");
    return NextResponse.json({ synced: 0 });
  }

  console.log(`[cron/whoop-sync] Syncing ${connections.length} user(s)…`);

  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      // Refresh token if close to expiry
      const expiresAt = new Date(conn.expires_at as string).getTime();
      let accessToken = conn.access_token as string;

      if (expiresAt <= Date.now() + 5 * 60 * 1000) {
        try {
          const refreshed = await refreshWhoopToken(conn.refresh_token as string);
          const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
          await supabase
            .from("whoop_connections")
            .update({
              access_token:  refreshed.access_token,
              refresh_token: refreshed.refresh_token,
              expires_at:    newExpires,
              updated_at:    new Date().toISOString(),
            })
            .eq("user_id", conn.user_id);
          accessToken = refreshed.access_token;
        } catch (e) {
          console.warn(`[cron/whoop-sync] Token refresh failed for ${conn.user_id}:`, e);
        }
      }

      // Sync yesterday's data via the existing sync endpoint
      const res = await fetch(`${appUrl}/api/whoop/sync`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: conn.user_id, access_token: accessToken }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sync failed for ${conn.user_id}: ${res.status} ${text}`);
      }

      return conn.user_id;
    })
  );

  let synced = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      synced++;
      console.log(`[cron/whoop-sync] ✓ ${result.value}`);
    } else {
      console.error(`[cron/whoop-sync] ✗`, result.reason);
    }
  }

  console.log(`[cron/whoop-sync] Done — ${synced}/${connections.length} synced`);
  return NextResponse.json({ synced, total: connections.length });
}
