"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { format, subDays, startOfMonth } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import { getBehavioralWeight } from "@/lib/categorize";
import {
  ArrowUpRight,
  CheckCircle,
  Circle,
  ChevronRight,
  Send,
} from "lucide-react";

ChartJS.register(
  CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
);

// ── Types ─────────────────────────────────────────────────────────────────────

type Transaction = {
  amount_cents: number;
  posted_at: string;
  category: string | null;
  merchant_name: string | null;
  description: string | null;
  is_necessary_expense: boolean | null;
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
  created_at: string | null;
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
  score_breakdown?: {
    health_score: number;
    fin_score: number;
  };
};

type ConvMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
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
// ── Spending bar chart ────────────────────────────────────────────────────────
// Custom HTML chart: neutral bars + baseline dotted line + per-day risk dots
const BAR_AREA_H = 108;
const LABEL_H    = 18;
const DOT_AREA   = 12;
const MAX_BAR_H  = BAR_AREA_H - DOT_AREA;

function SpendingBarsChart({
  data,
  baseline,
}: {
  data: { date: string; label: string; spend: number; riskScore: number | undefined }[];
  baseline: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const totalH = BAR_AREA_H + LABEL_H;
  const maxSpend = Math.max(...data.map(d => d.spend), baseline > 0 ? baseline * 1.25 : 20, 20);

  const dotColor = (score: number | undefined): string | undefined => {
    if (score == null) return undefined;
    if (score <= 30) return "#22c55e";
    if (score <= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="relative w-full" style={{ height: totalH }}>

      {/* Baseline dotted line */}
      {baseline > 0 && (() => {
        const bottomPx = LABEL_H + (baseline / maxSpend) * MAX_BAR_H;
        return (
          <div
            className="absolute pointer-events-none z-10"
            style={{ left: 0, right: 36, bottom: bottomPx, borderTop: "1px dashed", borderColor: "var(--text-muted)", opacity: 0.45 }}
          >
            <span
              className="absolute text-[8px] leading-none whitespace-nowrap"
              style={{ color: "var(--text-muted)", right: -40, top: -7 }}
            >
              ${Math.round(baseline)}/day
            </span>
          </div>
        );
      })()}

      {/* Bar columns */}
      <div className="absolute inset-x-0 top-0 flex gap-1" style={{ height: BAR_AREA_H }}>
        {data.map((d, i) => {
          const barH   = d.spend > 0 ? Math.max((d.spend / maxSpend) * MAX_BAR_H, 3) : 2;
          const color  = dotColor(d.riskScore);
          const active = hoverIdx === i;
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center justify-end h-full"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <div style={{ height: DOT_AREA, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {color && <div style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: color }} />}
              </div>
              <div
                style={{
                  width: "100%", height: barH, flexShrink: 0,
                  backgroundColor: active ? "var(--gold)" : "var(--text)",
                  opacity: active ? 0.9 : d.spend > 0 ? 0.48 : 0.13,
                  borderRadius: "2px 2px 0 0",
                  transition: "opacity 0.1s, background-color 0.1s",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="absolute inset-x-0 bottom-0 flex gap-1" style={{ height: LABEL_H }}>
        {data.map(d => (
          <div key={d.date} className="flex-1 text-center" style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: `${LABEL_H}px` }}>
            {d.label}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hoverIdx !== null && (() => {
        const d     = data[hoverIdx];
        const color = dotColor(d.riskScore);
        const rl    = d.riskScore == null ? null : d.riskScore <= 30 ? "LOW" : d.riskScore <= 60 ? "MEDIUM" : "HIGH";
        const diff  = baseline > 0 && d.spend > 0 ? d.spend - baseline : null;
        const flip  = hoverIdx >= data.length - 2;
        return (
          <div
            className="absolute top-1 z-20 pointer-events-none"
            style={{ left: `${((hoverIdx + 0.5) / data.length) * 100}%`, transform: flip ? "translateX(-110%)" : "translateX(6px)" }}
          >
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap backdrop-blur-sm" style={{ fontSize: 11 }}>
              <p className="font-semibold text-[var(--text)]">{format(parseLocalDate(d.date), "EEE, MMM d")}</p>
              <p className="text-[var(--text-dim)] mt-0.5">{d.spend > 0 ? `$${d.spend.toFixed(2)} spent` : "No spending"}</p>
              {rl && <p className="mt-0.5 font-medium" style={{ color: color ?? "inherit" }}>{rl} risk</p>}
              {diff !== null && (
                <p className="mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {diff > 0 ? `$${diff.toFixed(0)} above baseline` : `$${Math.abs(diff).toFixed(0)} below baseline`}
                </p>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
function recoveryColor(score: number) {
  if (score >= 67) return "var(--safe)";
  if (score >= 34) return "var(--warn)";
  return "var(--danger)";
}

const NON_BEHAVIORAL = new Set(["Internal Transfer", "ATM Withdrawal", "Income"]);

/** Returns true if the transaction should count toward behavioral spending. */
function isBillable(t: Transaction): boolean {
  return (
    t.amount_cents > 0 &&
    !NON_BEHAVIORAL.has(t.category ?? "") &&
    t.is_necessary_expense !== true
  );
}

/**
 * Behavioral weighted amount: raw cents × subcategory impulse weight.
 * e.g. $100 food delivery (0.9) = $90 weighted; $100 groceries (0.1) = $10.
 */
function weightedCents(t: Transaction): number {
  return t.amount_cents * getBehavioralWeight(t.category);
}

/**
 * Daily weighted-behavioral baseline = total weighted discretionary spend ÷ days.
 * Uses up to 90 days so sparse recent months still produce a real baseline.
 */
function computeBaseline(txs: Transaction[]): number {
  const ninetyDaysAgo = format(subDays(new Date(), 90), "yyyy-MM-dd");
  const qualifying = txs.filter(
    t => isBillable(t) && String(t.posted_at).slice(0, 10) >= ninetyDaysAgo,
  );
  if (!qualifying.length) return 0;
  // Use weighted amounts in the baseline so the comparison is apples-to-apples
  const total = qualifying.reduce((s, t) => s + weightedCents(t) / 100, 0);
  const dates = qualifying.map(t => String(t.posted_at).slice(0, 10)).sort();
  const spanDays = Math.max(
    1,
    Math.round(
      (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1,
  );
  return total / Math.min(spanDays, 90);
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
  const [miniMessages,    setMiniMessages]    = useState<ConvMessage[]>([]);
  const [miniInput,       setMiniInput]       = useState("");
  const [miniLoading,     setMiniLoading]     = useState(false);
  const miniBottomRef       = useRef<HTMLDivElement>(null);
  const hasGeneratedOpening = useRef(false);

  useEffect(() => { checkAuth(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate Backbone opening when data is loaded but conversation is empty
  useEffect(() => {
    if (!authChecked || !userId || hasGeneratedOpening.current) return;
    if (miniMessages.length === 0 && (healthHistory.length > 0 || insightsHistory.length > 0)) {
      hasGeneratedOpening.current = true;
      void generateOpening();
    }
  }, [authChecked, userId, miniMessages.length, healthHistory.length, insightsHistory.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll mini chat to bottom when messages update
  useEffect(() => {
    miniBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [miniMessages]);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    const uid = data.session.user.id;
    setUserEmail(data.session.user.email || null);
    setUserId(uid);
    setAuthChecked(true);

    // Load all data in parallel; capture health rows to decide on auto-sync
    const [, , , healthRows] = await Promise.all([
      loadConversation(),
      loadTransactions(),
      loadPlaidItems(),
      loadHealthData(),
      loadBehavioralInsights(),
    ]);

    // Fire background Whoop sync if today's data is stale or missing.
    // Does not block rendering — runs fully in the background.
    void silentWhoopSync(uid, healthRows ?? []);
  }

  async function loadTransactions() {
    const cutoff = format(subDays(new Date(), 90), "yyyy-MM-dd");
    const { data } = await supabase
      .from("transactions")
      .select("amount_cents, posted_at, category, merchant_name, description, is_necessary_expense")
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
      .select("date, sleep_hours, hrv_avg, active_energy, whoop_recovery_score, whoop_strain, resting_heart_rate, created_at")
      .order("date", { ascending: false })
      .limit(7);
    if (data) setHealthHistory(data);
    return data ?? [];
  }

  /**
   * Silently sync today's Whoop data in the background if:
   *  - today's row is completely missing, OR
   *  - today's row was last written more than 2 hours ago.
   * No loading state, no toast. Refreshes health + insights when done.
   */
  async function silentWhoopSync(uid: string, rows: HealthRow[]) {
    const today = format(new Date(), "yyyy-MM-dd");
    const todayRow = rows.find(r => r.date === today);

    const needsSync = !todayRow || (() => {
      if (!todayRow.created_at) return true;
      const ageMs = Date.now() - new Date(todayRow.created_at).getTime();
      return ageMs > 2 * 60 * 60 * 1000; // > 2 hours
    })();

    if (!needsSync) return;

    try {
      await fetch("/api/whoop/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, date: today }),
      });
      // Refresh health data and risk score silently after sync
      await loadHealthData();
      await loadBehavioralInsights();
    } catch {
      // Silent failure — this is a background convenience sync
    }
  }

  async function loadBehavioralInsights() {
    const { data } = await supabase
      .from("behavioral_insights")
      .select("date, risk_score, insights, spending_summary")
      .order("date", { ascending: false })
      .limit(90);
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

  async function loadConversation() {
    // Only load today's messages — prior-day messages carry stale/hallucinated
    // health numbers that the model anchors on and repeats.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("backbone_conversations")
      .select("id, role, content, created_at")
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: true });
    setMiniMessages((data ?? []) as ConvMessage[]);
  }

  async function generateOpening() {
    if (!userId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    setMiniLoading(true);

    // Clear any existing conversation rows for today before generating a fresh
    // opening. This prevents yesterday's or an earlier session's hallucinated
    // numbers from leaking into the new context window.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await supabase
      .from("backbone_conversations")
      .delete()
      .eq("user_id", userId)
      .gte("created_at", todayStart.toISOString());

    // Build a grounded opening prompt using only verified values from state —
    // these come from the DB query in loadHealthData(), not from chat history.
    const parts: string[] = [];
    if (todayHealth?.whoop_recovery_score != null) parts.push(`Recovery ${todayHealth.whoop_recovery_score}%`);
    if (todayHealth?.hrv_avg != null)              parts.push(`HRV ${todayHealth.hrv_avg}ms`);
    if (todayHealth?.sleep_hours != null)          parts.push(`Sleep ${todayHealth.sleep_hours.toFixed(1)}h`);
    if (rScore != null)                            parts.push(`Risk score ${rScore}/100 (${riskLabel(rScore)} risk)`);
    if (todayInsight?.spending_summary?.change_percent) {
      const pct = parseFloat(todayInsight.spending_summary.change_percent);
      if (!isNaN(pct)) parts.push(`Spending ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% vs last week`);
    }
    const openingPrompt = parts.length > 0
      ? `Based on my data today (${parts.join(", ")}), give me a brief 1-2 sentence check-in with the single most important insight. End with one short question.`
      : "Give me a brief welcome message. Ask what I want to explore today.";
    try {
      const res = await fetch("/api/backbone/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // Never pass prior conversation history to the opening — the system
        // prompt context is already fully grounded with today's DB data.
        body: JSON.stringify({ message: openingPrompt, conversationHistory: [] }),
      });
      const data = await res.json();
      if (data.response) {
        await supabase.from("backbone_conversations").insert({
          user_id: userId,
          role: "assistant",
          content: data.response,
        });
        await loadConversation();
      }
    } catch { /* silent fail */ }
    setMiniLoading(false);
  }

  async function sendMiniChat(text: string) {
    if (!text.trim() || miniLoading || !userId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    setMiniInput("");
    setMiniLoading(true);
    await supabase.from("backbone_conversations").insert({ user_id: userId, role: "user", content: text });
    await loadConversation();
    try {
      const res = await fetch("/api/backbone/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          // miniMessages is already filtered to today-only by loadConversation —
          // send the last 10 so the model has the current session's turn history
          // without carrying over stale prior-day hallucinations.
          conversationHistory: miniMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const reply = data.response ?? "Backbone is unavailable right now.";
      await supabase.from("backbone_conversations").insert({ user_id: userId, role: "assistant", content: reply });
    } catch {
      await supabase.from("backbone_conversations").insert({ user_id: userId, role: "assistant", content: "Backbone is unavailable right now. Try again in a moment." });
    }
    await loadConversation();
    setMiniLoading(false);
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

  // 7-day spending bars (billable only), colored by risk level
  const weeklyChartData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      const spend = transactions
        .filter(t => isBillable(t) && String(t.posted_at).slice(0, 10) === d)
        .reduce((s, t) => s + t.amount_cents / 100, 0);
      days.push({ date: d, label: format(parseLocalDate(d), "EEE"), spend, riskScore: insightByDate[d] });
    }
    return days;
  }, [transactions, insightByDate]);

  // Weekly / monthly spending totals + top category (all exclude non-behavioral)
  const spendingStats = useMemo(() => {
    const weekCutoff  = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const monthCutoff = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const weekTxs  = transactions.filter(t => isBillable(t) && String(t.posted_at).slice(0, 10) >= weekCutoff);
    const monthTxs = transactions.filter(t => isBillable(t) && String(t.posted_at).slice(0, 10) >= monthCutoff);
    const weekTotal  = weekTxs.reduce((s, t) => s + t.amount_cents / 100, 0);
    const monthTotal = monthTxs.reduce((s, t) => s + t.amount_cents / 100, 0);
    const byCat: Record<string, number> = {};
    for (const t of weekTxs) {
      // Use parent category as grouping label for top-category display
      const cat = t.category || "Other";
      byCat[cat] = (byCat[cat] ?? 0) + t.amount_cents / 100;
    }
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const topCat = sorted[0] ? { name: sorted[0][0], amount: sorted[0][1] } : null;
    return { weekTotal, monthTotal, topCat };
  }, [transactions]);

  // Baseline: total billable spending last 30 days ÷ 30
  const baseline = useMemo(
    () => computeBaseline(transactions),
    [transactions],
  );

  // Behavioral tax this month:
  // sum of (daily discretionary spend - daily baseline) on MEDIUM+HIGH risk days, clamped ≥0.
  // Only days where we actually have spending data contribute, to avoid deflating the result
  // with zero-spend elevated days (e.g. weekends with no transactions).
  const behavioralTax = useMemo(() => {
    if (baseline <= 0) return 0;
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    // All MEDIUM/HIGH risk days this calendar month that have an insight row
    const elevatedDates = new Set(
      insightsHistory.filter(i => i.risk_score > 30 && i.date >= monthStart).map(i => i.date),
    );
    if (!elevatedDates.size) return 0;

    // Sum weighted discretionary spend per elevated day
    const byDay: Record<string, number> = {};
    for (const t of transactions) {
      const d = String(t.posted_at).slice(0, 10);
      if (isBillable(t) && elevatedDates.has(d))
        byDay[d] = (byDay[d] ?? 0) + weightedCents(t) / 100;
    }

    // Only count days that actually have spending — zero-spend elevated days
    // (e.g. a high-risk Saturday with no purchases) should not count against the tax.
    const daysWithSpend = Object.keys(byDay);
    if (!daysWithSpend.length) return 0;

    const totalElevatedSpend = Object.values(byDay).reduce((s, v) => s + v, 0);
    const tax = totalElevatedSpend - daysWithSpend.length * baseline;
    return Math.max(0, tax);
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
      .filter(t => isBillable(t) && similar.has(String(t.posted_at).slice(0, 10)))
      .slice(0, 8);
    const byDay: Record<string, number> = {};
    for (const t of transactions) {
      const d = String(t.posted_at).slice(0, 10);
      if (isBillable(t) && similar.has(d)) byDay[d] = (byDay[d] ?? 0) + weightedCents(t) / 100;
    }
    const vals = Object.values(byDay);
    const avgSpend = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { txs, avgSpend };
  }, [todayInsight, insightsHistory, transactions, today]);

  // This Week summary — extended with tax, trigger, and spend trend
  const weekInsights = useMemo(() => {
    const cutoff = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const last7  = insightsHistory.filter(i => i.date >= cutoff);
    if (!last7.length) return null;
    const best  = last7.reduce<InsightRow | null>((b, i) => !b || i.risk_score < b.risk_score ? i : b, null);
    const worst = last7.reduce<InsightRow | null>((w, i) => !w || i.risk_score > w.risk_score ? i : w, null);
    const lowCount      = last7.filter(i => i.risk_score <= 30).length;
    const highRiskCount = last7.filter(i => i.risk_score > 30).length;
    const highCount     = last7.filter(i => i.risk_score > 60).length;

    // Spending trend from the most recent insight
    const rawPct = last7[0]?.spending_summary?.change_percent;
    const spendChangePct = rawPct ? parseFloat(rawPct) : null;

    // Weekly behavioral tax: sum of (daily weighted spend - baseline) on elevated days
    const elevated = new Set(last7.filter(i => i.risk_score > 30).map(i => i.date));
    const byDay: Record<string, number> = {};
    for (const t of transactions) {
      const d = String(t.posted_at).slice(0, 10);
      if (isBillable(t) && d >= cutoff && elevated.has(d))
        byDay[d] = (byDay[d] ?? 0) + weightedCents(t) / 100;
    }
    const weekTaxElevatedSpend = Object.values(byDay).reduce((s, v) => s + v, 0);
    const weekTax = Math.max(0, weekTaxElevatedSpend - elevated.size * (baseline || 0));

    // Most common trigger: infer from health data this week
    const sleepRows = healthHistory.filter(r => r.sleep_hours != null && r.date >= cutoff);
    const hrvRows   = healthHistory.filter(r => r.hrv_avg   != null && r.date >= cutoff);
    const avgSleep  = sleepRows.length ? sleepRows.reduce((s, r) => s + (r.sleep_hours ?? 0), 0) / sleepRows.length : null;
    const avgHrv    = hrvRows.length   ? hrvRows.reduce((s, r)   => s + (r.hrv_avg    ?? 0), 0) / hrvRows.length   : null;
    let trigger: string | null = null;
    if (highRiskCount > 0) {
      if (avgSleep != null && avgSleep < 6.5)   trigger = `poor sleep (avg ${avgSleep.toFixed(1)}h this week)`;
      else if (avgHrv != null && avgHrv < 45)   trigger = `elevated stress (avg HRV ${Math.round(avgHrv)}ms this week)`;
    }

    return { best, worst, lowCount, highCount, highRiskCount, spendChangePct, weekTax, trigger, dayCount: last7.length };
  }, [insightsHistory, transactions, baseline, healthHistory]);

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

  // Insight bullets for Zone 1 — always generated from real metric values
  const insightBullets = useMemo(() => {
    const b: string[] = [];

    // Sleep
    if (todayHealth?.sleep_hours != null) {
      const h = todayHealth.sleep_hours;
      b.push(h >= 7
        ? `Slept ${h.toFixed(1)}h — above your 7h target ✓`
        : `Slept ${h.toFixed(1)}h — below your 7h target ✗`);
    }

    // HRV
    if (todayHealth?.hrv_avg != null) {
      const hrv = todayHealth.hrv_avg;
      if (hrv >= 70)       b.push(`HRV ${hrv}ms — well recovered ✓`);
      else if (hrv >= 50)  b.push(`HRV ${hrv}ms — normal range ✓`);
      else if (hrv >= 35)  b.push(`HRV ${hrv}ms — elevated stress ✗`);
      else                 b.push(`HRV ${hrv}ms — high stress ✗`);
    }

    // Strain (fills slot if sleep/HRV didn't already reach 3)
    if (b.length < 3 && todayHealth?.whoop_strain != null) {
      const s = todayHealth.whoop_strain;
      if (s >= 18)       b.push(`Strain ${s.toFixed(1)} — heavy load ✗`);
      else if (s >= 14)  b.push(`Strain ${s.toFixed(1)} — strenuous activity ✓`);
      else if (s >= 10)  b.push(`Strain ${s.toFixed(1)} — moderate activity ✓`);
      else               b.push(`Strain ${s.toFixed(1)} — light day ✓`);
    }

    // Spending change vs last week (from behavioral_insights spending_summary)
    if (b.length < 3 && todayInsight?.spending_summary?.change_percent) {
      const pct = parseFloat(todayInsight.spending_summary.change_percent);
      if (!isNaN(pct)) {
        if (Math.abs(pct) < 5)
          b.push("Spending on track vs last week ✓");
        else
          b.push(`Spending ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% vs last week${pct > 0 ? " ✗" : " ✓"}`);
      }
    }

    return b.slice(0, 3);
  }, [todayHealth, todayInsight]);

  // Forward-looking actionable advice for the Today tab — 4–5 insights covering different angles
  const todayAdvice = useMemo(() => {
    const items: string[] = [];

    // 1. Sleep
    if (todayHealth?.sleep_hours != null) {
      const h = todayHealth.sleep_hours;
      if (h >= 7)      items.push(`Slept ${h.toFixed(1)}h — above your 7h target, decision-making is sharp today`);
      else if (h >= 6) items.push(`Slept ${h.toFixed(1)}h — slightly under target, mild fatigue may affect choices`);
      else             items.push(`Slept ${h.toFixed(1)}h — below your 7h target, fatigue is active today`);
    }

    // 2. HRV
    if (todayHealth?.hrv_avg != null) {
      const hrv = todayHealth.hrv_avg;
      if (hrv >= 70)      items.push(`HRV ${hrv}ms — well recovered, stress levels are low`);
      else if (hrv >= 50) items.push(`HRV ${hrv}ms — normal range, moderate readiness`);
      else if (hrv >= 35) items.push(`HRV ${hrv}ms — elevated stress, spending willpower may be reduced`);
      else                items.push(`HRV ${hrv}ms — high stress, delay big purchases today if possible`);
    }

    // 3. Spending trend vs last week
    if (todayInsight?.spending_summary?.change_percent) {
      const pct = parseFloat(todayInsight.spending_summary.change_percent);
      if (!isNaN(pct)) {
        if (Math.abs(pct) < 5)  items.push("Spending on track vs last week — no significant shift");
        else if (pct > 0)        items.push(`Spending up ${Math.round(pct)}% vs last week — above your usual pattern`);
        else                     items.push(`Spending down ${Math.abs(Math.round(pct))}% vs last week — on track`);
      }
    }

    // 4. Today's risk prediction
    if (todayInsight) {
      const level = riskLevel(todayInsight.risk_score);
      const extra = daysLikeTodayData.avgSpend > 0 && baseline > 0
        ? Math.max(0, daysLikeTodayData.avgSpend - baseline) : 0;
      if (level === "LOW")
        items.push(`${todayInsight.risk_score}/100 risk — good time for any planned purchases`);
      else if (level === "MEDIUM")
        items.push(extra > 0
          ? `${todayInsight.risk_score}/100 risk — history shows $${extra.toFixed(0)} extra spend on days like this`
          : `${todayInsight.risk_score}/100 risk — one trigger active, be mindful of impulse purchases`);
      else
        items.push(extra > 0
          ? `${todayInsight.risk_score}/100 risk — high alert, you may spend $${extra.toFixed(0)} extra today`
          : `${todayInsight.risk_score}/100 risk — high alert, watch food delivery and discretionary spending`);
    }

    // 5. This week's risk pattern
    const weekCutoff = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const last7 = insightsHistory.filter(i => i.date >= weekCutoff);
    if (last7.length >= 2) {
      const lowCount  = last7.filter(i => i.risk_score <= 30).length;
      const highCount = last7.filter(i => i.risk_score > 60).length;
      if (lowCount >= 3)
        items.push(`${lowCount} low risk days this week — your best streak this month`);
      else if (highCount >= 3)
        items.push(`${highCount} high risk days this week — rest is the highest leverage action right now`);
      else
        items.push(`${lowCount} low risk day${lowCount !== 1 ? "s" : ""} out of ${last7.length} this week — ${lowCount >= Math.ceil(last7.length / 2) ? "solid week so far" : "room to improve"}`);
    }

    return items.slice(0, 5);
  }, [todayInsight, todayHealth, daysLikeTodayData.avgSpend, baseline, insightsHistory]);

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
    <AppShell userEmail={userEmail} onLogout={() => void logout()}>

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
      <div className="mb-4">
        <div className={`${CARD} p-6 sm:p-10 text-center`}>
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

                {/* Score breakdown */}
                {todayInsight?.score_breakdown && (
                  <div className="flex items-center justify-center gap-4 text-xs text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-[var(--gold)] opacity-70" />
                      Health <span className="font-semibold text-[var(--text-dim)] ml-0.5">{todayInsight.score_breakdown.health_score}</span>
                      <span className="opacity-50">×60%</span>
                    </span>
                    <span className="text-[var(--border)]">·</span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-[var(--safe)] opacity-70" />
                      Spending <span className="font-semibold text-[var(--text-dim)] ml-0.5">{todayInsight.score_breakdown.fin_score}</span>
                      <span className="opacity-50">×40%</span>
                    </span>
                  </div>
                )}
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
                <Link
                  href="/insights"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-sm font-semibold text-[var(--gold)] transition-colors"
                >
                  Ask Backbone →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">No risk score yet</p>
                <button
                  onClick={() => void calculateBehavioralRisk()}
                  disabled={calculating}
                  className="text-sm px-5 py-2 rounded-xl bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25 border border-[var(--gold)]/30 text-[var(--gold)] disabled:opacity-40 transition-colors"
                >
                  {calculating ? "Calculating…" : "Calculate now"}
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          ZONE 2 — Insights strip + mini Backbone chat
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
        </div>

        {insightsTab === "today" ? (
          <div className="space-y-2 mb-4">
            {todayAdvice.length > 0 ? (
              todayAdvice.map((s, i) => (
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
                  : "Advice will appear once today's risk score is available."}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {weekInsights ? (
              <>
                {/* Best day */}
                {weekInsights.best && (
                  <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--safe-dim)] border border-[var(--safe)]/20">
                    <span className="text-[var(--safe)] shrink-0 mt-0.5">↑</span>
                    <span className="text-sm text-[var(--text)]">
                      Best day: <strong>{format(parseLocalDate(weekInsights.best.date), "EEEE, MMM d")}</strong>
                      {" "}— {riskLabel(weekInsights.best.risk_score)} risk ({weekInsights.best.risk_score}/100)
                    </span>
                  </div>
                )}
                {/* Worst day */}
                {weekInsights.worst && weekInsights.worst.date !== weekInsights.best?.date && (
                  <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--warn-dim)] border border-[var(--warn)]/20">
                    <span className="text-[var(--warn)] shrink-0 mt-0.5">↓</span>
                    <span className="text-sm text-[var(--text)]">
                      Hardest day: <strong>{format(parseLocalDate(weekInsights.worst.date), "EEEE, MMM d")}</strong>
                      {" "}— {riskLabel(weekInsights.worst.risk_score)} risk ({weekInsights.worst.risk_score}/100)
                    </span>
                  </div>
                )}
                {/* Behavioral tax this week */}
                <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]">
                  <span className={weekInsights.weekTax > 5 ? "text-[var(--danger)] shrink-0 mt-0.5" : "text-[var(--safe)] shrink-0 mt-0.5"}>→</span>
                  <span className="text-sm text-[var(--text)]">
                    {weekInsights.weekTax > 5
                      ? `Behavioral tax this week: $${weekInsights.weekTax.toFixed(0)} above baseline`
                      : "Behavioral tax this week: within baseline — no significant overspend"}
                  </span>
                </div>
                {/* Spending trend */}
                {weekInsights.spendChangePct != null && !isNaN(weekInsights.spendChangePct) && (
                  <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]">
                    <span className={weekInsights.spendChangePct <= 0 ? "text-[var(--safe)] shrink-0 mt-0.5" : "text-[var(--danger)] shrink-0 mt-0.5"}>
                      {weekInsights.spendChangePct <= 0 ? "↓" : "↑"}
                    </span>
                    <span className="text-sm text-[var(--text)]">
                      {Math.abs(weekInsights.spendChangePct) < 5
                        ? "Spending on track vs last week — no significant change"
                        : weekInsights.spendChangePct > 0
                          ? `Spending up ${Math.round(weekInsights.spendChangePct)}% vs last week — above previous pace`
                          : `Spending down ${Math.abs(Math.round(weekInsights.spendChangePct))}% vs last week — below previous pace`}
                    </span>
                  </div>
                )}
                {/* Main trigger or forward-looking suggestion */}
                <div className="flex gap-2.5 items-start px-3.5 py-2.5 rounded-lg bg-[var(--glass-subtle)] border border-[var(--border)]">
                  <span className="text-[var(--gold)] shrink-0 mt-0.5">→</span>
                  <span className="text-sm text-[var(--text)]">
                    {weekInsights.trigger
                      ? `Main trigger this week: ${weekInsights.trigger}`
                      : weekInsights.lowCount >= weekInsights.highRiskCount
                        ? `${weekInsights.lowCount} low-risk days — you are on a solid streak this week`
                        : "Mixed week — a good night's sleep can flip tomorrow's score significantly"}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-1">
                Not enough weekly data yet — check back after a few more days.
              </p>
            )}
          </div>
        )}

        {/* ── Mini Backbone chat ────────────────────────────────────────────── */}
        <div className="border-t border-[var(--border)] pt-4">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Backbone</p>

          {/* Message area — max 200px, scrollable */}
          <div className="max-h-[200px] overflow-y-auto space-y-2 mb-3 pr-1">
            {miniLoading && miniMessages.length === 0 && (
              <div className="flex justify-start">
                <div className="bg-[var(--glass-subtle)] border border-[var(--border)] px-3 py-2 rounded-xl text-xs text-[var(--text-muted)]">
                  Backbone is thinking…
                </div>
              </div>
            )}
            {miniMessages.length === 0 && !miniLoading && (
              <p className="text-xs text-[var(--text-muted)] py-1">Ask Backbone anything about today…</p>
            )}
            {miniMessages.slice(-4).map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[var(--gold)] text-[#080808]"
                    : "bg-[var(--glass-subtle)] border border-[var(--border)] text-[var(--text)]"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {miniLoading && miniMessages.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-[var(--glass-subtle)] border border-[var(--border)] px-3 py-2 rounded-xl">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1 h-1 bg-[var(--text-dim)] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={miniBottomRef} />
          </div>

          {/* Input */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={miniInput}
              onChange={e => setMiniInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void sendMiniChat(miniInput); }}
              placeholder="Ask Backbone…"
              className="flex-1 px-3 py-2 text-xs border border-[var(--glass-border)] rounded-lg bg-[var(--glass-subtle)] text-[var(--text)] placeholder-[var(--text-muted)] outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
            />
            <button
              onClick={() => void sendMiniChat(miniInput)}
              disabled={!miniInput.trim() || miniLoading}
              className="px-3 py-2 bg-[var(--gold)] text-[#080808] rounded-lg disabled:opacity-40 transition-opacity hover:opacity-90"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <Link
            href="/insights"
            className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--gold)] transition-colors"
          >
            Continue in Insights <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
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

            {/* Spending stat pills */}
            <div className="flex gap-2 flex-wrap mb-5">
              {[
                {
                  label: "This week",
                  value: spendingStats.weekTotal > 0 ? `$${spendingStats.weekTotal.toFixed(0)}` : "—",
                },
                {
                  label: "This month",
                  value: spendingStats.monthTotal > 0 ? `$${spendingStats.monthTotal.toFixed(0)}` : "—",
                },
                ...(spendingStats.topCat ? [{
                  label: "Top category",
                  value: `${spendingStats.topCat.name} $${spendingStats.topCat.amount.toFixed(0)}`,
                }] : []),
              ].map(p => (
                <div
                  key={p.label}
                  className="px-3 py-2 rounded-xl bg-[var(--glass-subtle)] border border-[var(--border)] flex flex-col gap-0.5 min-w-0"
                >
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">{p.label}</span>
                  <span className="text-sm font-bold text-[var(--text)] truncate">{p.value}</span>
                </div>
              ))}
            </div>

            {/* Weekly spend chart */}
            <div className="mb-5">
              <p className="text-xs font-medium text-[var(--text-muted)] mb-2">7-day spending</p>
              <SpendingBarsChart data={weeklyChartData} baseline={baseline} />
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5 opacity-60">
                Dots show your behavioral risk level each day
              </p>
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
              ) : daysLikeTodayData.txs.length < 3 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Still building your pattern history — check back in a few days.
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
              { label: "Sleep",  value: todayHealth?.sleep_hours  != null ? `${todayHealth.sleep_hours.toFixed(1)}h`  : null },
              { label: "HRV",    value: todayHealth?.hrv_avg       != null ? `${todayHealth.hrv_avg}ms`               : null },
              { label: "Strain", value: todayHealth?.whoop_strain  != null ? `${todayHealth.whoop_strain.toFixed(1)}` : null },
            ].filter(p => p.value !== null).map(p => (
              <div
                key={p.label}
                className="px-3 py-2.5 rounded-xl bg-[var(--glass-subtle)] border border-[var(--border)] flex flex-col gap-0.5"
              >
                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">{p.label}</span>
                <span className="text-base font-bold text-[var(--text)]">{p.value}</span>
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
          ZONE 4 — Baseline comparison
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-4 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-5 backdrop-blur-[28px]">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--gold)] mb-2">
          Your Baseline
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
          Setup checklist (hidden once complete)
      ════════════════════════════════════════════════════════════════════════ */}
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
                  onClick={() => void calculateBehavioralRisk()}
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

    </AppShell>
  );
}
