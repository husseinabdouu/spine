"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import PlaidLink from "@/components/PlaidLink";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import {
  User,
  CreditCard,
  Heart,
  Shield,
  LogOut,
  CheckCircle,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Smartphone,
  RefreshCw,
  Zap,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";

type PlaidItem = {
  id: string;
  institution_name: string;
  created_at: string;
};

type HealthData = {
  date: string;
  sleep_hours: number | null;
  hrv_avg: number | null;
  active_energy: number | null;
  created_at: string;
};

type WhoopConnection = {
  whoop_user_id: number | null;
  updated_at: string;
};

const CARD = "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";
const SHORTCUT_URL = "https://spine-one.vercel.app/api/health/submit";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { toast }    = useToast();
  const [userEmail, setUserEmail]           = useState<string | null>(null);
  const [userId, setUserId]                 = useState<string | null>(null);
  const [memberSince, setMemberSince]       = useState<string | null>(null);
  const [plaidItems, setPlaidItems]         = useState<PlaidItem[]>([]);
  const [latestHealth, setLatestHealth]     = useState<HealthData | null>(null);
  const [whoopConn, setWhoopConn]                   = useState<WhoopConnection | null>(null);
  const [whoopSyncing, setWhoopSyncing]             = useState(false);
  const [disconnectingWhoop, setDisconnectingWhoop] = useState(false);
  const [loading, setLoading]                       = useState(true);
  const [disconnecting, setDisconnecting]           = useState<string | null>(null);
  const [copied, setCopied]                         = useState(false);
  const [backfilling, setBackfilling]               = useState(false);
  const [backfillResult, setBackfillResult]         = useState<string | null>(null);
  const [updatingWebhook, setUpdatingWebhook]       = useState(false);
  const [webhookResult, setWebhookResult]           = useState<string | null>(null);
  const [whoopError, setWhoopError]                 = useState<string | null>(null);
  const [whoopBackfilling, setWhoopBackfilling]     = useState(false);
  const [whoopBackfillResult, setWhoopBackfillResult] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  // Handle OAuth return params
  useEffect(() => {
    const whoop  = searchParams.get("whoop");
    const error  = searchParams.get("error");
    const detail = searchParams.get("detail");
    if (whoop === "connected") {
      toast("Whoop connected! Syncing yesterday's data…", "success");
      loadWhoopConnection(); // refresh UI immediately
      router.replace("/settings");
    } else if (error?.startsWith("whoop")) {
      const base: Record<string, string> = {
        whoop_denied:        "Whoop authorisation was cancelled.",
        whoop_failed:        "Whoop connection failed.",
        whoop_db_error:      "Could not save Whoop connection.",
        whoop_invalid_state: "Invalid OAuth state. Please try again.",
      };
      const decoded = detail ? decodeURIComponent(detail) : null;
      const msg = base[error] ?? "Whoop connection error.";
      toast(msg + (decoded ? ` ${decoded}` : ""), "error");
      setWhoopError(decoded ?? msg);
      router.replace("/settings");
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    const user = data.session.user;
    setUserEmail(user.email || null);
    setUserId(user.id);
    setMemberSince(user.created_at);
    await Promise.all([loadPlaidItems(), loadLatestHealth(user.id), loadWhoopConnection()]);
    setLoading(false);
  }

  const loadPlaidItems = useCallback(async () => {
    const { data } = await supabase
      .from("plaid_items")
      .select("id, institution_name, created_at")
      .order("created_at", { ascending: false });
    if (data) setPlaidItems(data);
  }, []);

  async function loadWhoopConnection() {
    const { data } = await supabase
      .from("whoop_connections")
      .select("whoop_user_id, updated_at")
      .single();
    setWhoopConn(data ?? null);
  }

  async function loadLatestHealth(uid: string) {
    const { data } = await supabase
      .from("health_data")
      .select("date, sleep_hours, hrv_avg, active_energy, created_at")
      .eq("user_id", uid)
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (data) setLatestHealth(data);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
  }

  async function disconnectBank(itemId: string) {
    if (!userId) {
      toast("Not logged in — please refresh the page", "error");
      return;
    }
    const confirmed = window.confirm(
      "Disconnect this bank? Your existing transactions will be deleted so there are no duplicates when you reconnect. This is required to pull your full history from Plaid."
    );
    if (!confirmed) return;

    setDisconnecting(itemId);
    try {
      const res = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, item_id: itemId }),
      });
      const text = await res.text();
      let data: { success?: boolean; error?: string } = {};
      try { data = JSON.parse(text); } catch { /* not JSON */ }

      if (res.ok && data.success) {
        toast("Bank disconnected successfully.", "success");
        setPlaidItems(prev => prev.filter(i => i.id !== itemId));
      } else {
        const msg = data.error || `Server returned ${res.status}: ${text.slice(0, 100)}`;
        toast(`Disconnect failed: ${msg}`, "error");
        console.error("[disconnectBank] error:", msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Disconnect failed: ${msg}`, "error");
      console.error("[disconnectBank] network error:", msg);
    }
    setDisconnecting(null);
  }

  function handlePlaidSuccess() {
    toast("Bank connected! Fetching transaction history…", "success");
    loadPlaidItems();
  }

  async function updateWebhook() {
    if (!userId) return;
    setUpdatingWebhook(true);
    setWebhookResult(null);
    try {
      const res  = await fetch("/api/plaid/update-webhook", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (data.success) {
        const ok = (data.results as { institution: string; success: boolean }[])
          .filter(r => r.success)
          .map(r => r.institution)
          .join(", ");
        setWebhookResult(`Webhook updated for: ${ok}. Plaid will now send transaction events to Spine.`);
        toast("Webhook updated!", "success");
      } else {
        setWebhookResult(`Error: ${data.error}`);
        toast(data.error ?? "Failed", "error");
      }
    } catch {
      toast("Failed to update webhook", "error");
    }
    setUpdatingWebhook(false);
  }

  async function runBackfill() {
    if (!userId) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res  = await fetch("/api/plaid/backfill", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, start_date: "2024-09-05" }),
      });
      const data = await res.json();
      if (data.success) {
        const total  = data.total_in_db ?? 0;
        const netNew = data.net_new_transactions ?? 0;
        setBackfillResult(
          `Done — ${total.toLocaleString()} transactions in Spine` +
          (netNew > 0 ? ` (+${netNew} new this run).` : ` (no new rows added).`) +
          (total < 600 ? " Plaid is still fetching your full history in the background — run backfill again in 30 min to see it grow." : "")
        );
        toast(`Backfill complete — ${total.toLocaleString()} total transactions in Spine`, "success");
      } else {
        setBackfillResult(`Error: ${data.error}`);
        toast(data.error ?? "Backfill failed", "error");
      }
    } catch {
      setBackfillResult("Network error — check Vercel logs.");
      toast("Backfill failed", "error");
    }
    setBackfilling(false);
  }

  async function backfillWhoop() {
    if (!userId) return;
    setWhoopBackfilling(true);
    setWhoopBackfillResult(null);
    try {
      const res  = await fetch("/api/whoop/backfill", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (data.success) {
        const msg = `Done — ${data.synced} days synced, ${data.skipped} skipped (no data), ${data.errors} errors.` +
          (data.errors > 0 ? ` First error dates: ${(data.error_dates ?? []).join(", ")}` : "");
        setWhoopBackfillResult(msg);
        toast(`Whoop backfill complete — ${data.synced} days synced`, "success");
      } else {
        setWhoopBackfillResult(`Error: ${data.error}`);
        toast(data.error ?? "Backfill failed", "error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setWhoopBackfillResult(`Error: ${msg}`);
      toast("Whoop backfill failed", "error");
    }
    setWhoopBackfilling(false);
  }

  async function syncWhoop() {
    if (!userId) return;
    setWhoopSyncing(true);
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];
      const res  = await fetch("/api/whoop/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, date: dateStr }),
      });
      const data = await res.json();
      if (data.success) {
        toast("Whoop data synced!", "success");
        loadLatestHealth(userId);
      } else {
        toast(data.error ?? "Sync failed", "error");
      }
    } catch {
      toast("Whoop sync failed", "error");
    }
    setWhoopSyncing(false);
  }

  async function disconnectWhoop() {
    setDisconnectingWhoop(true);
    try {
      const { error } = await supabase.from("whoop_connections").delete().neq("id", "");
      if (error) throw error;
      setWhoopConn(null);
      toast("Whoop disconnected", "info");
    } catch {
      toast("Failed to disconnect Whoop", "error");
    }
    setDisconnectingWhoop(false);
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(SHORTCUT_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <AppShell userEmail={null}>
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-[var(--text-dim)] animate-pulse">Loading…</p>
        </div>
      </AppShell>
    );
  }

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "??";

  return (
    <AppShell title="Settings" userEmail={userEmail} onLogout={logout}>
      <div className="max-w-2xl space-y-5">

        {/* ── Account ─────────────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <User className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Account</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold)] font-bold text-sm shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-[var(--text)] font-medium truncate">{userEmail}</div>
              {memberSince && (
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  Member since {format(parseISO(memberSince), "MMMM yyyy")}
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 pt-5 border-t border-[var(--border)]">
            <button
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </section>

        {/* ── Bank Connections ─────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <CreditCard className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Bank Connections</h2>
          </div>

          {plaidItems.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-[var(--text-muted)] text-sm mb-4">No bank connected yet.</p>
              <PlaidLink onSuccess={handlePlaidSuccess} />
            </div>
          ) : (
            <div className="space-y-3">
              {plaidItems.map(item => (
                <div key={item.id} className="flex items-center justify-between bg-white/[0.03] border border-[var(--border)] rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--safe-dim)] flex items-center justify-center shrink-0">
                      <CreditCard className="w-4 h-4 text-[var(--safe)]" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--text)]">{item.institution_name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        Connected {format(parseLocalDate(item.created_at.slice(0, 10)), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-xs text-[var(--safe)]">
                      <CheckCircle className="w-3 h-3" /> Active
                    </span>
                    <button
                      onClick={() => disconnectBank(item.id)}
                      disabled={disconnecting === item.id}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-50"
                    >
                      {disconnecting === item.id ? "Removing…" : "Disconnect"}
                    </button>
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <PlaidLink onSuccess={handlePlaidSuccess} />
              </div>

              {/* Update webhook */}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">Update webhook</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Tells Plaid where to send transaction events. Run this once if your bank was connected before the production URL was configured — it unlocks the full 24-month history sync.
                    </p>
                    {webhookResult && (
                      <p className="text-xs text-[var(--safe)] mt-1.5">{webhookResult}</p>
                    )}
                  </div>
                  <button
                    onClick={updateWebhook}
                    disabled={updatingWebhook}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-[var(--border)] text-[var(--text-dim)] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <Zap className={`w-3.5 h-3.5 ${updatingWebhook ? "animate-pulse" : ""}`} />
                    {updatingWebhook ? "Updating…" : "Update webhook"}
                  </button>
                </div>
              </div>

              {/* Backfill */}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">Full history backfill</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Forces Plaid to re-fetch everything from Sept 5, 2024 → today using both sync and get pipelines. Safe to run multiple times — no duplicates.
                    </p>
                    {backfillResult && (
                      <p className="text-xs text-[var(--safe)] mt-1.5">{backfillResult}</p>
                    )}
                  </div>
                  <button
                    onClick={runBackfill}
                    disabled={backfilling}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-[var(--gold)] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${backfilling ? "animate-spin" : ""}`} />
                    {backfilling ? "Running…" : "Run backfill"}
                  </button>
                </div>
                {backfilling && (
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    This takes 15–30 seconds — Plaid needs time to refresh. Don&apos;t close the page.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Health Sync ──────────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <Heart className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Health Sync</h2>
          </div>

          {/* Last sync status */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-white/[0.03] border border-[var(--border)] mb-5">
            {latestHealth ? (
              <>
                <CheckCircle className="w-4 h-4 text-[var(--safe)] mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--text)]">Last sync: {format(parseLocalDate(latestHealth.date), "EEEE, MMM d")}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1 space-x-3">
                    {latestHealth.sleep_hours != null && <span>Sleep {latestHealth.sleep_hours}h</span>}
                    {latestHealth.hrv_avg != null && <span>HRV {latestHealth.hrv_avg}ms</span>}
                    {latestHealth.active_energy != null && <span>{latestHealth.active_energy?.toLocaleString()} steps</span>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm text-[var(--text-dim)]">No health data synced yet</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">Follow the steps below to set up your iOS Shortcut</div>
                </div>
              </>
            )}
          </div>

          {/* Setup instructions */}
          <div className="space-y-4">
            <p className="text-sm font-medium text-[var(--text)]">iOS Shortcut setup</p>
            <ol className="space-y-3 text-sm text-[var(--text-dim)]">
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <span>Open the <strong className="text-[var(--text)]">Shortcuts</strong> app on your iPhone and create a new shortcut</span>
              </li>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                <span>Add a <strong className="text-[var(--text)]">Get Contents of URL</strong> action, set method to <strong className="text-[var(--text)]">POST</strong>, and paste this URL:</span>
              </li>
            </ol>

            {/* Copyable URL */}
            <div className="flex items-center gap-2 bg-black/40 border border-[var(--border)] rounded-lg px-4 py-3">
              <code className="text-xs text-[var(--gold)] flex-1 truncate font-mono">{SHORTCUT_URL}</code>
              <button
                onClick={copyUrl}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-[var(--safe)]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <ol className="space-y-3 text-sm text-[var(--text-dim)]" start={3}>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                <span>Set the request body to <strong className="text-[var(--text)]">JSON</strong> with these fields:</span>
              </li>
            </ol>

            <div className="bg-black/40 border border-[var(--border)] rounded-lg px-4 py-3">
              <pre className="text-xs text-[var(--text-dim)] font-mono leading-relaxed whitespace-pre-wrap">{`{
  "user_id": "${userId}",
  "date": "YYYY-MM-DD",
  "sleep_hours": 7.5,
  "hrv": 58,
  "steps": 6200
}`}</pre>
            </div>

            <ol className="space-y-3 text-sm text-[var(--text-dim)]" start={4}>
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                <span>Add an <strong className="text-[var(--text)]">Automation</strong> to run it daily at 7am so yesterday's data is always synced</span>
              </li>
            </ol>

            <a
              href="https://support.apple.com/guide/shortcuts/welcome/ios"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--gold)] hover:opacity-80 transition-opacity"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Apple Shortcuts guide
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </section>

        {/* ── Whoop ────────────────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <Zap className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Whoop</h2>
          </div>

          {/* Status pill */}
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 ${
            whoopConn
              ? "bg-[var(--safe-dim)] text-[var(--safe)]"
              : "bg-white/[0.06] text-[var(--text-muted)]"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${whoopConn ? "bg-[var(--safe)]" : "bg-[var(--text-muted)]"}`} />
            {whoopConn ? "Connected" : "Not connected"}
          </div>

          {whoopConn ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-white/[0.03] border border-[var(--border)]">
                <CheckCircle className="w-4 h-4 text-[var(--safe)] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text)]">Whoop connected</div>
                  {whoopConn.updated_at && (
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      Last synced {format(parseISO(whoopConn.updated_at), "MMM d, yyyy 'at' h:mm a")}
                    </div>
                  )}
                  {whoopConn.whoop_user_id && (
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      Whoop user #{whoopConn.whoop_user_id}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={syncWhoop}
                  disabled={whoopSyncing}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-sm text-[var(--text-dim)] disabled:opacity-40 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${whoopSyncing ? "animate-spin" : ""}`} />
                  {whoopSyncing ? "Syncing…" : "Sync now"}
                </button>
                <button
                  onClick={disconnectWhoop}
                  disabled={disconnectingWhoop}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-40"
                >
                  {disconnectingWhoop ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>

              {whoopBackfillResult && (
                <p className="text-xs text-[var(--safe)]">{whoopBackfillResult}</p>
              )}

              <div className="pt-3 border-t border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">Backfill history</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Fetches your complete Whoop history — every recovery, sleep, and strain record — and syncs it all into Spine. Run this once. Takes ~30 seconds.
                    </p>
                  </div>
                  <button
                    onClick={backfillWhoop}
                    disabled={whoopBackfilling}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00D4A4]/10 hover:bg-[#00D4A4]/20 border border-[#00D4A4]/30 text-[#00D4A4] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${whoopBackfilling ? "animate-spin" : ""}`} />
                    {whoopBackfilling ? "Backfilling all time…" : "Backfill all time"}
                  </button>
                </div>
                {whoopBackfilling && (
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Fetching all-time data from Whoop — takes ~30 seconds. Don&apos;t close the page.
                  </p>
                )}
              </div>

              <p className="text-xs text-[var(--text-muted)]">
                Recovery, sleep, and strain sync automatically via webhooks. Use &ldquo;Sync now&rdquo; to pull the latest manually.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-dim)]">
                Connect your Whoop to automatically sync recovery score, HRV, sleep performance, and strain into Spine.
              </p>
              <button
                onClick={() => {
                  if (userId) window.location.href = `/api/whoop/auth?user_id=${userId}`;
                }}
                disabled={!userId}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00D4A4] hover:opacity-90 disabled:opacity-40 text-black text-sm font-bold transition-opacity"
              >
                <Zap className="w-4 h-4" />
                Connect Whoop
              </button>
              {whoopError && (
                <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30">
                  <p className="text-xs text-[var(--danger)] font-medium">Connection failed</p>
                  <p className="text-xs text-[var(--danger)]/80 mt-0.5 break-all">{whoopError}</p>
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                You&apos;ll be redirected to Whoop to authorise. Spine requests read-only access to recovery, sleep, and activity.
              </p>
            </div>
          )}
        </section>

        {/* ── Privacy & Legal ──────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <Shield className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Privacy & Legal</h2>
          </div>
          <div className="space-y-3">
            {[
              { href: "/privacy",         label: "Privacy Policy" },
              { href: "/data-policy",     label: "Data Retention & Deletion Policy" },
              { href: "/security-policy", label: "Information Security Policy" },
            ].map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0 text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors group"
              >
                {label}
                <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Questions about your data? <a href="mailto:husseinabdou06@gmail.com" className="text-[var(--gold)] hover:opacity-80">husseinabdou06@gmail.com</a>
          </p>
        </section>

      </div>
    </AppShell>
  );
}
