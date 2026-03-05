import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshWhoopToken } from "@/lib/wearables/whoop";
import { format, subDays } from "date-fns";

const BASE = "https://api.prod.whoop.com/developer/v1";

async function whoopRaw(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}

/**
 * GET /api/whoop/debug?user_id=xxx&date=YYYY-MM-DD
 * Returns the raw Whoop API responses for recovery, sleep and cycle for a given date.
 * Also returns the token's scope so we can verify permissions.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const date   = searchParams.get("date") ?? format(subDays(new Date(), 1), "yyyy-MM-dd");

  if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const supabase = createClient();
  const { data: conn } = await supabase
    .from("whoop_connections")
    .select("access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .single();

  if (!conn) return NextResponse.json({ error: "No Whoop connection" }, { status: 404 });

  let token = conn.access_token as string;
  const expiresAt = new Date(conn.expires_at as string).getTime();
  if (expiresAt <= Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshWhoopToken(conn.refresh_token as string);
    token = refreshed.access_token;
  }

  const start = `${date}T00:00:00.000Z`;
  const end   = `${date}T23:59:59.999Z`;
  const qs    = `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=5`;

  // Probe every plausible path variant to find what Whoop actually accepts
  const probes: Record<string, string> = {
    cycle_date:              `/cycle${qs}`,
    recovery_date:           `/recovery${qs}`,
    recovery_bare:           `/recovery?limit=1`,
    activity_recovery_bare:  `/activity/recovery?limit=1`,
    sleep_date:              `/activity/sleep${qs}`,
    sleep_bare:              `/activity/sleep?limit=1`,
    sleep_root_bare:         `/sleep?limit=1`,
    workout_bare:            `/activity/workout?limit=1`,
    body_measurement:        `/body/measurement`,
  };

  const results = await Promise.all(
    Object.entries(probes).map(async ([key, path]) => {
      const r = await whoopRaw(path, token);
      const records = (r.body as {records?: unknown[]})?.records;
      return [key, { status: r.status, ok: r.ok, records: records?.length ?? (r.ok ? "no records key" : undefined) }] as const;
    }),
  );

  const probeResults = Object.fromEntries(results);
  const cycleData    = await whoopRaw(`/cycle${qs}`, token);

  return NextResponse.json({
    date,
    scope_stored: conn.scope,
    probes:       probeResults,
    cycle_sample: (cycleData.body as {records?: unknown[]})?.records?.[0] ?? null,
  });
}
