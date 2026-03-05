"use client";

import { useEffect, useState, useMemo } from "react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import PlaidLink from "@/components/PlaidLink";
import AppShell from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { format, subDays, startOfMonth } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import {
  ArrowUpRight,
  CreditCard,
  RefreshCw,
  CheckCircle,
  Circle,
  ChevronRight,
} from "lucide-react";

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
);

// ── Types ─────────────────────────────────────────────────────────────────────

type Transaction = {
  amount_cents: number;
  posted_at: string;
  category: string | null;
  merchant_name: string | null;
  description: string | null;
};

type PlaidItem = {
  id: string;
  institution_name: string;
  created_at: string;
};

type HealthRow = {
  date: string;
  sleep_hours: number | null;
  hrv_avg: number | null;
  active_energy: number | null;
  whoop_recovery_score: number | null;
  whoop_strain: number | null;
  resting_heart_rate: number | null;
};

type InsightRow = {
  date: string;
  risk_score: number;
  insights: string[];
  spending_summary: {
    last_7_days: string;
    prev_7_days: string;
    change_percent: string;
  };
};

// ── Constants & helpers ───────────────────────────────────────────────────────

const CARD = "bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";

function riskColor(score: number) {
  if (score <= 30) return "var(--safe)";
  if (score <= 60) return "var(--warn)";
  return "var(--danger)";
}
function riskLabel(score: number) {
  if (score <= 30) return "LOW";
  if (score <= 60) return "MEDIUM";
  return "HIGH";
}
function riskBg(score: number) {
  if (score <= 30) return "var(--safe-dim)";
  if (score <= 60) return "var(--warn-dim)";
  return "var(--danger-dim)";
}
function riskLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score <= 30) return "LOW";
  if (score <= 60) return "MEDIUM";
  return "HIGH";
}
function barColor(score: number | undefined): string {
  if (score == null) return "rgba(201,168,76,0.55)";
  if (score <= 30) return "rgba(74,222,128,0.65)";
  if (score <= 60) return "rgba(250,204,21,0.65)";
  return "rgba(248,113,113,0.65)";
}
function recoveryColor(score: number) {
  if (score >= 67) return "var(--safe)";
  if (score >= 34) return "var(--warn)";
  return "var(--danger)";
}

function computeBaseline(txs: Transaction[], insights: InsightRow[]): number {
  const lowDates = new Set(insights.filter(i => i.risk_score <= 30).map(i => i.date));
  const byDay: Record<string, number> = {};
  for (const t of txs) {
    if (t.amount_cents > 0 && lowDates.has(String(t.posted_at).slice(0, 10))) {
      const d = String(t.posted_at).slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + t.amount_cents / 100;
    }
  }
  const vals = Object.values(byDay).sort((a, b) => a - b);
  if (!vals.length) return 0;
  return vals[Math.floor(vals.length / 2)];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark    = resolvedTheme !== "light";
  const chartGrid = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const chartTick = isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.32)";

  const router = useRouter();
  const [authChecked,     setAuthChecked]     = useState(false);
  const [userEmail,       setUserEmail]       = useState<string | null>(null);
  const [userId,          setUserId]          = useState<string | null>(null);
  const [transactions,    setTransactions]    = useState<Transaction[]>([]);
  const [plaidItems,      setPlaidItems]      = useState<PlaidItem[]>([]);
  const [healthHistory,   setHealthHistory]   = useState<HealthRow[]>([]);
  const [insightsHistory, setInsightsHistory] = useState<InsightRow[]>([]);
  const [syncing,         setSyncing]         = useState(false);
  const [disconnecting,   setDisconnecting]   = useState<string | null>(null);
  const [calculating,     setCalculating]     = useState(false);
  const [insightsTab,     setInsightsTab]     = useState<"today" | "week">("today");

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    setUserEmail(data.session.user.email || null);
    setUserId(data.session.user.id);
    setAuthChecked(true);
    await Promise.all([
      loadTransactions(),
      loadPlaidItems(),
      loadHealthData(),
      loadBehavioralInsights(),
    ]);
  }

  async function loadTransactions() {
    const cutoff = format(subDays(new Date(), 90), "yyyy-MM-dd");
    const { data } = await supabase
      .from("transactions")
      .select("amount_cents, posted_at, category, merchant_name, description")
      .gte("posted_at", cutoff)
      .order("posted_at", { ascending: false });
    if (data) setTransactions(data);
  }

  async function loadPlaidItems() {
    const { data } = await supabase
      .from("plaid_items")
      .select("id, institution_name, created_at")
      .order("created_at", { ascending: false });
    if (data) setPlaidItems(data);
  }

  async function loadHealthData() {
    const { data } = await supabase
      .from("health_data")
      .select("date, sleep_hours, hrv_avg, active_energy, whoop_recovery_score, whoop_strain, resting_heart_rate")
      .order("date", { ascending: false })
      .limit(7);
    if (data) setHealthHistory(data);
  }

  async function loadBehavioralInsights() {
    const { data } = await supabase
      .from("behavioral_insights")
      .select("date, risk_score, insights, spending_summary")
      .order("date", { ascending: false })
      .limit(30);
    if (data) setInsightsHistory(data);
  }

  async function calculateBehavioralRisk() {
    if (!userId) return;
    setCalculating(true);
    try {
      const res = await fetch("/api/insights/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (data.success) {
        toast("Risk score updated", "success");
        await loadBehavioralInsights();
      } else {
        toast(data.error || "Calculation failed", "error");
      }
    } catch {
      toast("Failed to calculate risk", "error");
    }
    setCalculating(false);
  }

  async function syncTransactions() {
    if (!userId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, force_resync: false }),
      });
      const data = await res.json();
      if (data.success) {
        toast(data.transactions_added > 0
          ? `Added ${data.transactions_added} new transactions`
          : "Already up to date", "success");
        await loadTransactions();
      } else {
        toast(data.error || "Sync failed", "error");
      }
    } catch {
      toast("Failed to sync", "error");
    }
    setSyncing(false);
  }

  function handlePlaidSuccess() {
    toast("Bank connected! Fetching transaction history…", "success");
    loadPlaidItems();
    syncTransactions();
  }

  async function disconnectBank(itemId: string) {
    if (!userId) return;
    setDisconnecting(itemId);
    try {
      const res = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, item_id: itemId }),
      });
      const data = await res.json();
      if (data.success) {
        toast("Bank disconnected", "info");
        loadPlaidItems();
      } else {
        toast(data.error || "Failed to disconnect", "error");
      }
    } catch {
      toast("Failed to disconnect", "error");
    }
    setDisconnecting(null);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const today       = format(new Date(), "yyyy-MM-dd");
  const todayInsight = useMemo(
    () => insightsHistory.find(i => i.date === today) ?? insightsHistory[0] ?? null,
    [insightsHistory, today],
  );
  const todayHealth = useMemo(
    () => healthHistory.find(h => h.date === today) ?? healthHistory[0] ?? null,
    [healthHistory, today],
  );
  const rScore = todayInsight?.risk_score ?? null;

  // insight-by-date map for chart coloring
  const insightByDate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of insightsHistory) m[i.date] = i.risk_score;
    return m;
  }, [insightsHistory]);

  // 7-day spending bars, colored by risk level
  const weeklyChartData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      const spend = transactions
        .filter(t => t.amount_cents > 0 && String(t.posted_at).slice(0, 10) === d)
        .reduce((s, t) => s + t.amount_cents / 100, 0);
      days.push({ date: d, label: format(parseLocalDate(d), "EEE"), spend, riskScore: insightByDate[d] });
    }
    return days;
  }, [transactions, insightByDate]);

  // Baseline (median daily spend on LOW risk days)
  const baseline = useMemo(
    () => computeBaseline(transactions, insightsHistory),
    [transactions, insightsHistory],
  );

  // Behavioral tax this month
  const behavioralTax = useMemo(() => {
    if (!baseline) return 0;
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const elevated   = new Set(
      insightsHistory.filter(i => i.risk_score > 30 && i.date >= monthStart).map(i => i.date),
    );
    const byDay: Record<string, number> = {};
    for (const t of transactions) {
      const d = String(t.posted_at).slice(0, 10);
      if (t.amount_cents > 0 && elevated.has(d)) byDay[d] = (byDay[d] ?? 0) + t.amount_cents / 100;
    }
    return Object.values(byDay).reduce((s, v) => s + Math.max(0, v - baseline), 0);
  }, [transactions, insightsHistory, baseline]);

  // Transactions from days in the same risk category as today
  const daysLikeTodayData = useMemo(() => {
    if (!todayInsight) return { txs: [], avgSpend: 0 };
    const level   = riskLevel(todayInsight.risk_score);
    const similar = new Set(
      insightsHistory
        .filter(i => riskLevel(i.risk_score) === level && i.date !== today)
        .map(i => i.date),
    );
    if (!similar.size) return { txs: [], avgSpend: 0 };
    const txs = transactions
      .filter(t => t.amount_cents > 0 && similar.has(String(t.posted_at).slice(0, 10)))
      .slice(0, 8);
    const byDay: Record<string, number> = {};
    for (const t of transactions) {
      const d = String(t.posted_at).slice(0, 10);
      if (t.amount_cents > 0 && similar.has(d)) byDay[d] = (byDay[d] ?? 0) + t.amount_cents / 100;
    }
    const vals = Object.values(byDay);
    const avgSpend = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { txs, avgSpend };
  }, [todayInsight, insightsHistory, transactions, today]);

  // This Week summary
  const weekInsights = useMemo(() => {
    const cutoff = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const last7  = insightsHistory.filter(i => i.date >= cutoff);
    if (!last7.length) return null;
    const best  = last7.reduce<InsightRow | null>((b, i) => !b || i.risk_score < b.risk_score ? i : b, null);
    const worst = last7.reduce<InsightRow | null>((w, i) => !w || i.risk_score > w.risk_score ? i : w, null);
    return { best, worst, highRiskCount: last7.filter(i => i.risk_score > 30).length };
  }, [insightsHistory]);

  // 7-day health trend (recovery or HRV)
  const healthTrend = useMemo(() => {
    const rows  = [...healthHistory].reverse();
    const useRec = rows.some(r => r.whoop_recovery_score != null);
    return {
      labels: rows.map(r => format(parseLocalDate(r.date), "EEE")),
      values: rows.map(r => (useRec ? r.whoop_recovery_score : r.hrv_avg) ?? null),
      label:  useRec ? "Recovery %" : "HRV ms",
    };
  }, [healthHistory]);

  // Insight bullets for Zone 1
  const insightBullets = useMemo(() => {
    if (todayInsight?.insights?.length) return todayInsight.insights.slice(0, 3);
    const b: string[] = [];
    if (todayHealth?.sleep_hours != null) {
      const h = todayHealth.sleep_hours;
      b.push(h >= 7 ? `Slept ${h.toFixed(1)}h ✓` : `Slept ${h.toFixed(1)}h (target: 7+)`);
    }
    if (todayHealth?.hrv_avg != null) {
      const hrv = todayHealth.hrv_avg;
      b.push(hrv >= 55 ? `HRV ${hrv}ms ✓` : hrv >= 40 ? `HRV ${hrv}ms (moderate)` : `HRV ${hrv}ms (stressed)`);
    }
    if (todayInsight?.spending_summary?.change_percent) {
      const pct = parseFloat(todayInsight.spending_summary.change_percent);
      if (!isNaN(pct) && Math.abs(pct) > 5)
        b.push(`Spending ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% this week`);
    }
    return b.slice(0, 3);
  }, [todayInsight, todayHealth]);

  const setupComplete = plaidItems.length > 0 && healthHistory.length > 0 && insightsHistory.length > 0;

  // Ring geometry (160×160, r=60)
  const RING_R = 60;
  const RING_C = 2 * Math.PI * RING_R;

  if (!authChecked) {
    return (
      <AppShell userEmail={null}>
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-pulse text-[var(--text-dim)]">Loading…</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell userEmail={userEmail} onLogout={logout}>

      {/* ── No bank connected banner ────────────────────────────────────────── */}
      {plaidItems.length === 0 && (
        <div className="mb-6 flex items-center justify-between gap-4 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--gold)]">Connect your bank to get started</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Link your account to sync transactions and calculate your behavioral risk score.</p>
          </div>
          <PlaidLink onSuccess={handlePlaidSuccess} />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          ZONE 1 — Hero ring
      ════════════════════════════════════════════════════════════════════════ */}
      <Link href="/insights" className="block mb-4 group">
        <div className={`${CARD} p-6 sm:p-10 text-center cursor-pointer transition-all group-hover:border-[var(--gold)]/40`}>
          <div className="flex flex-col items-center gap-5">

            {/* Ring */}
            <div className="relative">
              <svg width="160" height="160" className="-rotate-90">
                <circle
                  cx="80" cy="80" r={RING_R}
                  fill="none" stroke="var(--svg-track)" strokeWidth="12"
                />
                {rScore != null && (
                  <circle
                    cx="80" cy="80" r={RING_R}
                    fill="none"
                    stroke={riskColor(rScore)}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(rScore / 100) * RING_C} ${RING_C}`}
                    style={{ transition: "stroke-dasharray 0.9s ease" }}
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {rScore != null ? (
                  <>
                    <span className="text-4xl font-bold leading-none" style={{ color: riskColor(rScore) }}>
                      {rScore}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--text-muted)] mt-1 tracking-wider">/ 100</span>
                  </>
                ) : (
                  <span className="text-3xl font-bold text-[var(--text-muted)]">—</span>
                )}
              </div>
            </div>

            {/* Label + bullets */}
            {rScore != null ? (
              <div className="space-y-3">
                <span
                  className="inline-block text-sm font-bold px-5 py-1.5 rounded-full"
                  style={{ color: riskColor(rScore), backgroundColor: riskBg(rScore) }}
                >
                  {riskLabel(rScore)} RISK DAY
                </span>
                {insightBullets.length > 0 && (
                  <ul className="space-y-1.5 max-w-sm mx-auto text-left">
                    {insightBullets.map((b, i) => (
                      <li key={i} className="text-sm text-[var(--text-dim)] flex gap-2 items-start">
                        <span className="text-[var(--gold)] shrink-0 mt-0.5">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">No risk score yet</p>
                <button
                  onClick={e => { e.preventDefault(); calculateBehavioralRisk(); }}
                  disabled={calculating}
                  className="text-sm px-5 py-2 rounded-xl bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-[var(--gold)] disabled:opacity-40 transition-colors"
                >
                  {calculating ? "Calculating…" : "Calculate now"}
                </button>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors">
              <span>Ask Backbone for details</span>
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </Link>

      {/* ════════════════════════════════════════════════════════════════════════
          ZONE 2 — Insights strip
      ════════════════════════════════════════════════════════════════════════ */}
      <div className={`${CARD} p-5 mb-4`}>

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-[var(--border)] mb-4">
          {(["today", "week"] as const).map(t => (
            <button
              key={t}
              onClick={() => setInsightsTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                insightsTab === t
                  ? "border-[var(--gold)] text-[var(--text-strong)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]"
              }`}
            >
              {t === "today" ? "Today" : "This Week"}
            </button>
          ))}
          <div className="ml-auto">
            <button
              onClick={calculateBehavioralRisk}
              disabled={calculating}
              className="text-xs px-2.5 py-1 rounded-lg bg-[var(--glass-mid)] hover:bg-[var(--glass-hover)] text-[var(--text-dim)] disabled:opacity-40 transition-colors"
            >
              {calculating ? "…" : "Recalculate"}
            </button>
          </div>
        </div>

        {insightsTab === "today" ? (
          <div className="space-y-2">
            {todayInsight?.insights?.length ? (
              todayInsight.insights.slice(0, 3).map((s, i) => (
                <div
                  key={i}
                  className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]"
                >
                  <span className="text-[var(--gold)] shrink-0 mt-0.5">→</span>
                  <span className="text-sm text-[var(--text)]">{s}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-1">
                {insightsHistory.length === 0
                  ? "No insights yet — calculate your first risk score above."
                  : "Hit Recalculate to generate today's insights."}
              </p>
            )}
            <Link
              href="/insights"
              className="inline-flex items-center gap-1 text-xs text-[var(--gold)] hover:opacity-75 transition-opacity mt-2"
            >
              Ask Backbone a question <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {weekInsights ? (
              <>
                {weekInsights.best && (
                  <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--safe-dim)] border border-[var(--safe)]/20">
                    <span className="text-[var(--safe)] shrink-0 mt-0.5">↑</span>
                    <span className="text-sm text-[var(--text)]">
                      Best day: <strong>{format(parseLocalDate(weekInsights.best.date), "EEEE")}</strong>
                      {" "}— {riskLabel(weekInsights.best.risk_score)} risk ({weekInsights.best.risk_score}/100)
                    </span>
                  </div>
                )}
                {weekInsights.worst && weekInsights.worst.date !== weekInsights.best?.date && (
                  <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--warn-dim)] border border-[var(--warn)]/20">
                    <span className="text-[var(--warn)] shrink-0 mt-0.5">↓</span>
                    <span className="text-sm text-[var(--text)]">
                      Hardest day: <strong>{format(parseLocalDate(weekInsights.worst.date), "EEEE")}</strong>
                      {" "}— {riskLabel(weekInsights.worst.risk_score)} risk ({weekInsights.worst.risk_score}/100)
                    </span>
                  </div>
                )}
                <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]">
                  <span className="text-[var(--text-muted)] shrink-0 mt-0.5">→</span>
                  <span className="text-sm text-[var(--text)]">
                    {weekInsights.highRiskCount === 0
                      ? "All low-risk this week — solid baseline, keep it up."
                      : `${weekInsights.highRiskCount} elevated-risk day${weekInsights.highRiskCount !== 1 ? "s" : ""} this week — watch discretionary purchases on those days.`}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-1">
                Not enough weekly data yet — check back after a few more days.
              </p>
            )}
            <Link
              href="/insights"
              className="inline-flex items-center gap-1 text-xs text-[var(--gold)] hover:opacity-75 transition-opacity mt-2"
            >
              See full patterns <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          ZONE 3 — Two columns: Financial + Health
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* ── Left: Financial snapshot ────────────────────────────────────── */}
        <Link href="/transactions" className="block group">
          <div className={`${CARD} p-5 h-full cursor-pointer transition-all group-hover:border-[var(--gold)]/30`}>

            {/* Hero: behavioral tax */}
            <div className="mb-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">
                Behavioral Tax This Month
              </div>
              <div className="text-4xl font-bold leading-none" style={{ color: behavioralTax > 0 ? "var(--danger)" : "var(--safe)" }}>
                ${behavioralTax > 0 ? behavioralTax.toFixed(0) : "0"}
              </div>
              {baseline > 0 && (
                <p className="text-xs text-[var(--text-muted)] mt-1.5">
                  Your baseline day costs ${baseline.toFixed(0)}
                  {rScore != null && ` · today is a ${riskLabel(rScore)} risk day`}
                </p>
              )}
            </div>

            {/* Weekly spend chart with risk colors */}
            <div className="mb-5">
              <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                7-day spending
                <span className="ml-2 text-[10px] text-[var(--text-muted)] opacity-60">
                  (green=low · amber=med · red=high risk)
                </span>
              </div>
              {weeklyChartData.some(d => d.spend > 0) ? (
                <div className="h-28">
                  <Bar
                    data={{
                      labels: weeklyChartData.map(d => d.label),
                      datasets: [{
                        data: weeklyChartData.map(d => d.spend),
                        backgroundColor: weeklyChartData.map(d => barColor(d.riskScore)),
                        borderRadius: 4,
                        borderSkipped: false,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `$${(ctx.parsed.y ?? 0).toFixed(2)}` } },
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { color: chartTick, font: { size: 10 } }, border: { display: false } },
                        y: { grid: { color: chartGrid }, ticks: { color: chartTick, font: { size: 10 }, callback: v => `$${v}` }, border: { display: false } },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-28 flex items-center justify-center text-xs text-[var(--text-muted)]">
                  No spending data yet
                </div>
              )}
            </div>

            {/* On days like today */}
            <div>
              <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
                On days like today{rScore != null && ` (${riskLabel(rScore)} risk)`}
              </div>
              {!todayInsight ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Calculate your risk score to see spending patterns.
                </p>
              ) : daysLikeTodayData.txs.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Not enough data yet — check back after a few more days.
                </p>
              ) : (
                <>
                  <div className="space-y-0.5 mb-2">
                    {daysLikeTodayData.txs.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--border)]/40 last:border-0"
                      >
                        <div className="min-w-0 mr-2">
                          <span className="text-[var(--text)] truncate block">
                            {t.merchant_name || t.description || "Unknown"}
                          </span>
                          <span className="text-[var(--text-muted)]">
                            {format(parseLocalDate(String(t.posted_at).slice(0, 10)), "MMM d")}
                          </span>
                        </div>
                        <span className="font-medium text-[var(--text)] tabular-nums shrink-0">
                          ${(t.amount_cents / 100).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Avg on {riskLabel(rScore!)} risk days:{" "}
                    <span className="font-medium text-[var(--text)]">
                      ${daysLikeTodayData.avgSpend.toFixed(0)}
                    </span>
                    {baseline > 0 && (
                      <> · baseline: <span className="font-medium text-[var(--text)]">${baseline.toFixed(0)}</span></>
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] group-hover:text-[var(--gold)] transition-colors mt-4">
              All transactions <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </Link>

        {/* ── Right: Health snapshot ──────────────────────────────────────── */}
        <div className={`${CARD} p-5`}>

          {/* Hero: recovery */}
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">
              Today&apos;s Recovery
            </div>
            {todayHealth?.whoop_recovery_score != null ? (
              <div
                className="text-4xl font-bold leading-none"
                style={{ color: recoveryColor(todayHealth.whoop_recovery_score) }}
              >
                {todayHealth.whoop_recovery_score}%
              </div>
            ) : (
              <div className="text-4xl font-bold text-[var(--text-muted)] leading-none">—</div>
            )}
          </div>

          {/* Metric pills */}
          <div className="flex gap-2 flex-wrap mb-5">
            {[
              { label: "Sleep",  value: todayHealth?.sleep_hours  != null ? `${todayHealth.sleep_hours.toFixed(1)}h`       : null },
              { label: "HRV",    value: todayHealth?.hrv_avg       != null ? `${todayHealth.hrv_avg}ms`                     : null },
              { label: "Strain", value: todayHealth?.whoop_strain  != null ? `${todayHealth.whoop_strain.toFixed(1)}`       : null },
            ].filter(p => p.value !== null).map(p => (
              <div
                key={p.label}
                className="px-3 py-1.5 rounded-full bg-[var(--glass-subtle)] border border-[var(--border)] text-xs"
              >
                <span className="text-[var(--text-muted)]">{p.label} </span>
                <span className="font-semibold text-[var(--text)]">{p.value}</span>
              </div>
            ))}
            {!todayHealth && (
              <p className="text-xs text-[var(--text-muted)]">No health data synced yet</p>
            )}
          </div>

          {/* 7-day trend */}
          <div className="mb-4">
            <div className="text-xs font-medium text-[var(--text-muted)] mb-2">
              7-day {healthTrend.label}
            </div>
            {healthTrend.values.some(v => v != null) ? (
              <div className="h-28">
                <Line
                  data={{
                    labels: healthTrend.labels,
                    datasets: [{
                      label: healthTrend.label,
                      data: healthTrend.values,
                      borderColor: "var(--gold)",
                      backgroundColor: "transparent",
                      pointBackgroundColor: "var(--gold)",
                      tension: 0.35,
                      pointRadius: 3,
                    }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { mode: "index" as const, intersect: false },
                    },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: chartTick, font: { size: 10 } }, border: { display: false } },
                      y: { grid: { color: chartGrid }, ticks: { color: chartTick, font: { size: 10 } }, border: { display: false } },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-28 flex items-center justify-center text-xs text-[var(--text-muted)]">
                No trend data yet
              </div>
            )}
          </div>

          <Link
            href="/health"
            className="inline-flex items-center gap-1 text-xs text-[var(--gold)] hover:opacity-75 transition-opacity"
          >
            See full health data <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          ZONE 4 — Baseline comparison (the punchline)
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-5 backdrop-blur-[28px]">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--gold)] mb-2">
          The Punchline
        </div>
        {rScore != null && baseline > 0 ? (
          rScore > 30 ? (
            <>
              <p className="text-base font-semibold text-[var(--text-strong)]">
                On {riskLabel(rScore).toLowerCase()} risk days you typically spend{" "}
                <span style={{ color: riskColor(rScore) }}>
                  ${Math.max(0, daysLikeTodayData.avgSpend - baseline).toFixed(0)} extra.
                </span>
              </p>
              <p className="text-sm text-[var(--text-dim)] mt-1">
                Your baseline is ${baseline.toFixed(0)}/day. Today is a {riskLabel(rScore).toLowerCase()} risk
                day — be intentional with purchases.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-[var(--text-strong)]">
                You&apos;re in baseline mode today. <span className="text-[var(--safe)]">Low risk ✓</span>
              </p>
              <p className="text-sm text-[var(--text-dim)] mt-1">
                Low risk days are your financial baseline — ${baseline.toFixed(0)}/day. This is your best self.
              </p>
            </>
          )
        ) : (
          <>
            <p className="text-base font-semibold text-[var(--text-strong)]">
              Calculate your risk score to unlock your behavioral pattern.
            </p>
            <p className="text-sm text-[var(--text-dim)] mt-1">
              Spine compares your spending on good vs tough days to quantify the exact dollar cost of stress and poor sleep.
            </p>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          Bank controls + Setup checklist
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Bank</span>
            {plaidItems.length > 0 && (
              <button
                onClick={syncTransactions}
                disabled={syncing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--glass-mid)] hover:bg-[var(--glass-hover)] text-[var(--text-dim)] disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync"}
              </button>
            )}
          </div>
          {plaidItems.length === 0 ? (
            <PlaidLink onSuccess={handlePlaidSuccess} />
          ) : (
            <div className="space-y-2">
              {plaidItems.map(item => (
                <div key={item.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[var(--safe)]" />
                    <span className="text-sm text-[var(--text)]">{item.institution_name}</span>
                  </div>
                  <button
                    onClick={() => disconnectBank(item.id)}
                    disabled={disconnecting === item.id}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-40"
                  >
                    {disconnecting === item.id ? "Removing…" : "Disconnect"}
                  </button>
                </div>
              ))}
              <PlaidLink onSuccess={handlePlaidSuccess} />
            </div>
          )}
        </div>

        {!setupComplete && (
          <div className={`${CARD} p-5`}>
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] block mb-4">Setup</span>
            <ul className="space-y-3">
              {[
                { done: plaidItems.length > 0,      label: "Connect bank account" },
                { done: healthHistory.length > 0,   label: "Sync health data (Whoop)" },
                { done: insightsHistory.length > 0, label: "Calculate first risk score" },
              ].map(({ done, label }) => (
                <li key={label} className="flex items-center gap-2.5">
                  {done
                    ? <CheckCircle className="w-4 h-4 text-[var(--safe)] shrink-0" />
                    : <Circle     className="w-4 h-4 text-[var(--text-muted)] shrink-0" />}
                  <span className={`text-sm ${done ? "text-[var(--text-dim)] line-through" : "text-[var(--text-dim)]"}`}>
                    {label}
                  </span>
                </li>
              ))}
              {insightsHistory.length === 0 && plaidItems.length > 0 && (
                <li>
                  <button
                    onClick={calculateBehavioralRisk}
                    disabled={calculating}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-[var(--gold)] transition-colors disabled:opacity-40"
                  >
                    {calculating ? "Calculating…" : "Calculate risk score →"}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

    </AppShell>
  );
}
