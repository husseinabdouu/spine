"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
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
  Sun,
  Moon,
  Monitor,
  Activity,
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

type BackfillResult = {
  success: boolean;
  db_before: number;
  db_after: number;
  net_new: number;
  oldest_in_db: string | null;
  newest_in_db: string | null;
  by_institution: {
    institution: string;
    webhook_set: boolean;
    refresh_triggered: boolean;
    monthly_results: { month: string; plaid_count: number; inserted: number }[];
    from_sync: number;
    plaid_total_claim: number;
  }[];
  diagnosis: string | null;
  error?: string;
};

type DiagnoseResult = {
  db: { total: number; oldest: string | null; newest: string | null };
  linked_accounts?: { account_id: string; name: string; official_name: string | null; type: string; subtype: string | null; mask: string | null }[];
  plaid_item_db: { id: string; item_id: string; institution: string; cursor: string; connected_at: string };
  plaid_item_live: { webhook?: string | null; error?: string | null; update_type?: string | null; available_products?: string[]; billed_products?: string[] };
  plaid_full_range: { start_date: string; end_date: string; total_claimed: number; gap: number; error?: string | null };
  monthly_breakdown: { month: string; plaid_count: number | null; db_count: number; plaid_error?: string }[];
  monthly_totals: { plaid_sum: number; db_total: number; gap: number };
  error?: string;
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
  const { theme, setTheme } = useTheme();
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
  const [backfillResult, setBackfillResult]         = useState<BackfillResult | null>(null);
  const [updatingWebhook, setUpdatingWebhook]       = useState(false);
  const [webhookResult, setWebhookResult]           = useState<string | null>(null);
  const [diagnosing, setDiagnosing]                 = useState(false);
  const [diagnoseResult, setDiagnoseResult]         = useState<DiagnoseResult | null>(null);
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
        body:    JSON.stringify({ user_id: userId, start_date: "2025-09-01" }),
      });
      const data: BackfillResult = await res.json();
      setBackfillResult(data);
      if (data.success) {
        toast(`Backfill done — ${data.db_after.toLocaleString()} total, +${data.net_new} new`, "success");
      } else {
        toast(data.error ?? "Backfill failed", "error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBackfillResult({ success: false, db_before: 0, db_after: 0, net_new: 0, oldest_in_db: null, newest_in_db: null, by_institution: [], diagnosis: null, error: msg });
      toast("Backfill failed — check Vercel logs", "error");
    }
    setBackfilling(false);
  }

  async function runDiagnose() {
    if (!userId) return;
    setDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const res  = await fetch("/api/plaid/diagnose", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, months: 18 }),
      });
      const data: DiagnoseResult = await res.json();
      setDiagnoseResult(data);
      if (data.error) {
        toast(`Diagnose error: ${data.error}`, "error");
      } else {
        toast(`Diagnosis complete — Plaid has ${data.plaid_full_range?.total_claimed ?? "?"}, DB has ${data.db?.total ?? "?"}`, "info");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDiagnoseResult({ db: { total: 0, oldest: null, newest: null }, plaid_item_db: { id: "", item_id: "", institution: "", cursor: "", connected_at: "" }, plaid_item_live: {}, plaid_full_range: { start_date: "", end_date: "", total_claimed: 0, gap: 0 }, monthly_breakdown: [], monthly_totals: { plaid_sum: 0, db_total: 0, gap: 0 }, error: msg });
      toast("Diagnose failed", "error");
    }
    setDiagnosing(false);
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
    if (!userId) return;
    setDisconnectingWhoop(true);
    try {
      const { error } = await supabase
        .from("whoop_connections")
        .delete()
        .eq("user_id", userId);
      if (error) throw error;
      setWhoopConn(null);
      toast("Whoop disconnected", "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Failed to disconnect Whoop: ${msg}`, "error");
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
                <div key={item.id} className="flex items-center justify-between bg-[var(--glass-subtle)] border border-[var(--border)] rounded-lg px-4 py-3">
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
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--glass-mid)] hover:bg-[var(--glass-hover)] border border-[var(--border)] text-[var(--text-dim)] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <Zap className={`w-3.5 h-3.5 ${updatingWebhook ? "animate-pulse" : ""}`} />
                    {updatingWebhook ? "Updating…" : "Update webhook"}
                  </button>
                </div>
              </div>

              {/* Diagnose */}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">Diagnose transaction gap</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Queries Plaid directly and shows exactly what it has per month vs what&apos;s in Spine. Helps pinpoint whether the gap is on Plaid&apos;s side or ours.
                    </p>
                  </div>
                  <button
                    onClick={runDiagnose}
                    disabled={diagnosing}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--glass-mid)] hover:bg-[var(--glass-hover)] border border-[var(--border)] text-[var(--text-dim)] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <Activity className={`w-3.5 h-3.5 ${diagnosing ? "animate-pulse" : ""}`} />
                    {diagnosing ? "Diagnosing…" : "Diagnose"}
                  </button>
                </div>
                {diagnosing && (
                  <p className="text-xs text-[var(--text-muted)] mt-2 animate-pulse">
                    Querying Plaid month-by-month… takes ~20–30s. Don&apos;t close the page.
                  </p>
                )}
                {diagnoseResult && !diagnoseResult.error && (
                  <div className="mt-3 space-y-3">
                    {/* Summary row */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Spine DB",      val: diagnoseResult.db.total.toLocaleString(), sub: `${diagnoseResult.db.oldest ?? "?"} → ${diagnoseResult.db.newest ?? "?"}` },
                        { label: "Plaid claims",  val: (diagnoseResult.plaid_full_range.total_claimed ?? 0).toLocaleString(), sub: "total_transactions" },
                        { label: "Gap",           val: Math.max(0, diagnoseResult.plaid_full_range.gap ?? 0).toLocaleString(), sub: diagnoseResult.plaid_full_range.gap > 0 ? "missing from Spine" : "in sync ✓" },
                      ].map(({ label, val, sub }) => (
                        <div key={label} className="bg-[var(--glass-subtle)] border border-[var(--border)] rounded-lg p-3 text-center">
                          <div className="text-lg font-bold text-[var(--text-strong)]">{val}</div>
                          <div className="text-xs font-medium text-[var(--text-dim)]">{label}</div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</div>
                        </div>
                      ))}
                    </div>
                    {/* Linked accounts — the most important diagnostic */}
                    {diagnoseResult.linked_accounts && diagnoseResult.linked_accounts.length > 0 && (
                      <div className="bg-[var(--glass-subtle)] border border-[var(--border)] rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold text-[var(--text-dim)] uppercase tracking-wider">Linked accounts ({diagnoseResult.linked_accounts.length})</p>
                        {diagnoseResult.linked_accounts.map(a => {
                          const isCredit = a.type === "credit" || a.subtype === "credit card";
                          const isDepository = a.type === "depository";
                          return (
                            <div key={a.account_id} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${isCredit ? "border-[var(--gold)]/40 bg-[var(--gold)]/5" : "border-[var(--border)]"}`}>
                              <div>
                                <span className="font-medium text-[var(--text)]">{a.official_name ?? a.name}</span>
                                {a.mask && <span className="text-[var(--text-muted)] ml-1">••{a.mask}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${isCredit ? "bg-[var(--gold)]/15 text-[var(--gold)]" : isDepository ? "bg-[var(--safe-dim)] text-[var(--safe)]" : "bg-[var(--glass-mid)] text-[var(--text-muted)]"}`}>
                                  {a.subtype ?? a.type}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {diagnoseResult.linked_accounts.every(a => a.type !== "credit") && (
                          <p className="text-xs text-[var(--warn)] mt-1">
                            ⚠ No credit card linked — your spending transactions are likely on a Citi credit card, not your checking/savings account. Disconnect and reconnect Citibank, and make sure to select your credit card during the Plaid flow.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Webhook status */}
                    <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                      <span className="font-medium">Webhook:</span>
                      {diagnoseResult.plaid_item_live.webhook
                        ? <span className="text-[var(--safe)]">{String(diagnoseResult.plaid_item_live.webhook)}</span>
                        : <span className="text-[var(--warn)]">Not set — run Update webhook</span>
                      }
                    </div>
                    {diagnoseResult.plaid_item_live.error && (
                      <div className="text-xs text-[var(--danger)] bg-[var(--danger-dim)] border border-[var(--danger)]/20 rounded-lg px-3 py-2">
                        Plaid item error: {diagnoseResult.plaid_item_live.error}
                      </div>
                    )}
                    {/* Month-by-month table */}
                    <div className="bg-[var(--glass-subtle)] border border-[var(--border)] rounded-lg overflow-hidden">
                      <div className="grid grid-cols-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-3 py-2 border-b border-[var(--border)]">
                        <span>Month</span><span className="text-right">Plaid</span><span className="text-right">Spine</span>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {diagnoseResult.monthly_breakdown.map(m => {
                          const gap = (m.plaid_count ?? 0) - m.db_count;
                          return (
                            <div key={m.month} className={`grid grid-cols-3 px-3 py-1.5 text-xs border-b border-[var(--border)]/50 last:border-0 ${gap > 0 ? "bg-[var(--warn-dim)]" : ""}`}>
                              <span className="text-[var(--text-dim)]">{m.month}</span>
                              <span className={`text-right font-mono ${m.plaid_error ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
                                {m.plaid_error ? "err" : (m.plaid_count ?? 0)}
                              </span>
                              <span className={`text-right font-mono ${gap > 0 ? "text-[var(--warn)]" : "text-[var(--text)]"}`}>
                                {m.db_count}{gap > 0 ? ` (-${gap})` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {diagnoseResult?.error && (
                  <p className="text-xs text-[var(--danger)] mt-2">{diagnoseResult.error}</p>
                )}
              </div>

              {/* Backfill */}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">Full history backfill</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Registers webhook, triggers refresh, then fetches month-by-month from Sept 2025 → today. Takes ~45–60s. Safe to run multiple times.
                    </p>
                  </div>
                  <button
                    onClick={runBackfill}
                    disabled={backfilling}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-[var(--gold)] text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${backfilling ? "animate-spin" : ""}`} />
                    {backfilling ? "Running (45–60s)…" : "Run backfill"}
                  </button>
                </div>
                {backfilling && (
                  <p className="text-xs text-[var(--text-muted)] mt-2 animate-pulse">
                    Registering webhook → refreshing Plaid → fetching month by month… Don&apos;t close the page.
                  </p>
                )}
                {backfillResult && (
                  <div className="mt-3 space-y-2">
                    {backfillResult.error ? (
                      <p className="text-xs text-[var(--danger)]">{backfillResult.error}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Before", val: backfillResult.db_before.toLocaleString() },
                            { label: "After",  val: backfillResult.db_after.toLocaleString() },
                            { label: "New",    val: `+${backfillResult.net_new.toLocaleString()}` },
                          ].map(({ label, val }) => (
                            <div key={label} className="bg-[var(--glass-subtle)] border border-[var(--border)] rounded-lg p-2 text-center">
                              <div className="text-base font-bold text-[var(--text-strong)]">{val}</div>
                              <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
                            </div>
                          ))}
                        </div>
                        {backfillResult.oldest_in_db && (
                          <p className="text-xs text-[var(--text-muted)]">
                            Date range in DB: {backfillResult.oldest_in_db} → {backfillResult.newest_in_db}
                          </p>
                        )}
                        {backfillResult.by_institution.map(inst => (
                          <div key={inst.institution} className="text-xs text-[var(--text-dim)] space-y-0.5">
                            <span className="font-medium text-[var(--text)]">{inst.institution}</span>
                            {" — "}Plaid had {inst.plaid_total_claim?.toLocaleString() ?? 'N/A'} total
                            {" · "}sync reported {inst.from_sync?.toLocaleString() ?? 'N/A'}
                            {" · "}webhook {inst.webhook_set ? "✓" : "✗"}
                            {" · "}refresh {inst.refresh_triggered ? "✓" : "✗"}
                          </div>
                        ))}
                        {backfillResult.diagnosis && (
                          <p className="text-xs text-[var(--warn)] bg-[var(--warn-dim)] border border-[var(--warn)]/20 rounded-lg px-3 py-2">
                            {backfillResult.diagnosis}
                          </p>
                        )}
                      </>
                    )}
                  </div>
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
          <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)] mb-5">
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
            <div className="flex items-center gap-2 bg-[var(--code-bg)] border border-[var(--border)] rounded-lg px-4 py-3">
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

            <div className="bg-[var(--code-bg)] border border-[var(--border)] rounded-lg px-4 py-3">
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
              : "bg-[var(--glass-mid)] text-[var(--text-muted)]"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${whoopConn ? "bg-[var(--safe)]" : "bg-[var(--text-muted)]"}`} />
            {whoopConn ? "Connected" : "Not connected"}
          </div>

          {whoopConn ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]">
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--glass-mid)] hover:bg-[var(--glass-hover)] text-sm text-[var(--text-dim)] disabled:opacity-40 transition-colors"
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

        {/* ── Appearance ───────────────────────────────────────────────────── */}
        <section className={`${CARD} p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <Monitor className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-widest">Appearance</h2>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--text-dim)] mb-3">Choose your preferred color theme.</p>
            <div className="flex gap-2">
              {([
                { value: "light",  label: "Light",  Icon: Sun     },
                { value: "dark",   label: "Dark",   Icon: Moon    },
                { value: "system", label: "System", Icon: Monitor },
              ] as const).map(({ value, label, Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={`flex-1 flex flex-col items-center gap-2 py-3.5 rounded-xl border text-sm font-medium transition-all ${
                      active
                        ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--glass-subtle)]"
                        : "border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
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
