"use client";

import { useEffect, useState, useMemo } from "react";
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
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { format, subDays } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import { CATEGORY_COLORS } from "@/lib/categorize";
import {
  ArrowUpRight,
  CreditCard,
  Activity,
  Moon,
  Heart,
  RefreshCw,
  CheckCircle,
  Circle,
  Settings,
  TrendingUp,
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

type Transaction = {
  amount_cents: number;
  posted_at: string;
  category: string | null;
};

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
};

type BehavioralInsight = {
  date: string;
  risk_score: number;
  insights: string[];
  spending_summary: {
    last_7_days: string;
    prev_7_days: string;
    change_percent: string;
  };
};

const CARD = "bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";

export default function DashboardPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [behavioralInsight, setBehavioralInsight] = useState<BehavioralInsight | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    setUserEmail(data.session.user.email || null);
    setUserId(data.session.user.id);
    setAuthChecked(true);
    Promise.all([loadTransactions(), loadPlaidItems(), loadHealthData(), loadBehavioralInsights()]);
  }

  async function loadTransactions() {
    const dateStr = subDays(new Date(), 30).toISOString().split("T")[0];
    const { data } = await supabase
      .from("transactions")
      .select("amount_cents, posted_at, category")
      .gte("posted_at", dateStr)
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
      .select("date, sleep_hours, hrv_avg, active_energy")
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (data) setHealthData(data);
  }

  async function loadBehavioralInsights() {
    const { data } = await supabase
      .from("behavioral_insights")
      .select("date, risk_score, insights, spending_summary")
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (data) setBehavioralInsight(data);
  }

  // Only count actual expenses (positive amount_cents = money out)
  const weeklyExpenses = useMemo(() => {
    const cutoff = subDays(new Date(), 7).toISOString().split("T")[0];
    return transactions.filter(t => t.amount_cents > 0 && t.posted_at >= cutoff);
  }, [transactions]);

  const weeklySpend = useMemo(
    () => weeklyExpenses.reduce((s, t) => s + t.amount_cents, 0) / 100,
    [weeklyExpenses]
  );

  const chartData = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      byDay[format(subDays(new Date(), i), "yyyy-MM-dd")] = 0;
    }
    weeklyExpenses.forEach(t => {
      const ds = String(t.posted_at).slice(0, 10);
      if (ds in byDay) byDay[ds] += t.amount_cents / 100;
    });
    return Object.entries(byDay).map(([date, spend]) => ({
      spend,
      label: format(parseLocalDate(date), "EEE"),
    }));
  }, [weeklyExpenses]);

  const categoryData = useMemo(() => {
    const byCat: Record<string, number> = {};
    weeklyExpenses.forEach(t => {
      const cat = t.category || "Others";
      byCat[cat] = (byCat[cat] || 0) + t.amount_cents / 100;
    });
    return Object.entries(byCat)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [weeklyExpenses]);

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
        loadBehavioralInsights();
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
        toast(data.transactions_added > 0 ? `Added ${data.transactions_added} new transactions` : "Already up to date", "success");
        loadTransactions();
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

  function getRiskColor(score: number) {
    if (score <= 30) return "var(--safe)";
    if (score <= 60) return "var(--warn)";
    return "var(--danger)";
  }

  function getRiskLabel(score: number) {
    if (score <= 30) return "LOW";
    if (score <= 60) return "MEDIUM";
    return "HIGH";
  }

  function getRiskBg(score: number) {
    if (score <= 30) return "var(--safe-dim)";
    if (score <= 60) return "rgba(245,158,11,0.12)";
    return "var(--danger-dim)";
  }

  if (!authChecked) {
    return (
      <AppShell userEmail={null}>
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-pulse text-[var(--text-dim)]">Loading…</div>
        </div>
      </AppShell>
    );
  }

  const setupComplete = plaidItems.length > 0 && !!healthData && !!behavioralInsight;

  return (
    <AppShell userEmail={userEmail} onLogout={logout}>

      {/* ── No bank connected banner ─────────────────────────────────────── */}
      {plaidItems.length === 0 && (
        <div className="mb-6 flex items-center justify-between gap-4 bg-[var(--gold)]/10 border border-[var(--gold)]/30 rounded-xl px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--gold)]">Connect your bank to get started</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Link your account to sync transactions and calculate your behavioral risk score.</p>
          </div>
          <PlaidLink onSuccess={handlePlaidSuccess} />
        </div>
      )}

      {/* ── Top metrics row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

        {/* Behavioral Risk */}
        <div
          className={`${CARD} p-5`}
          style={behavioralInsight ? { borderLeftWidth: 3, borderLeftColor: getRiskColor(behavioralInsight.risk_score) } : undefined}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Behavioral Risk</span>
            <button
              onClick={calculateBehavioralRisk}
              disabled={calculating}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[var(--text-dim)] disabled:opacity-40 transition-colors"
            >
              {calculating ? "…" : "Recalculate"}
            </button>
          </div>
          {behavioralInsight ? (
            <>
              <div className="flex items-end gap-3 mb-3">
                <span className="text-5xl font-bold leading-none" style={{ color: getRiskColor(behavioralInsight.risk_score) }}>
                  {behavioralInsight.risk_score}
                </span>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full mb-1"
                  style={{ color: getRiskColor(behavioralInsight.risk_score), backgroundColor: getRiskBg(behavioralInsight.risk_score) }}
                >
                  {getRiskLabel(behavioralInsight.risk_score)}
                </span>
              </div>
              <ul className="space-y-1">
                {behavioralInsight.insights.slice(0, 2).map((s, i) => (
                  <li key={i} className="text-xs text-[var(--text-muted)] flex gap-1.5">
                    <span className="opacity-40 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-3xl font-bold text-[var(--text-muted)]">—</div>
              <p className="text-xs text-[var(--text-muted)]">Hit Recalculate to compute your score</p>
            </div>
          )}
        </div>

        {/* This Week */}
        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">This Week</span>
            <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)]" />
          </div>
          <div className="text-4xl font-bold text-white leading-none mb-1">
            ${weeklySpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">{weeklyExpenses.length} expenses in the last 7 days</p>
          <Link href="/transactions" className="inline-flex items-center gap-1 text-xs text-[var(--gold)] hover:opacity-80 transition-opacity">
            <TrendingUp className="w-3 h-3" /> View all transactions
          </Link>
        </div>

        {/* Health */}
        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Today&apos;s Health</span>
            {healthData && (
              <span className="text-xs text-[var(--text-muted)]">
                {format(parseLocalDate(healthData.date), "MMM d")}
              </span>
            )}
          </div>
          {healthData ? (
            <div className="space-y-3">
              {healthData.sleep_hours != null && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)]">
                    <Moon className="w-3.5 h-3.5" />
                    <span className="text-xs">Sleep</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{healthData.sleep_hours.toFixed(1)}h</span>
                </div>
              )}
              {healthData.hrv_avg != null && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)]">
                    <Heart className="w-3.5 h-3.5" />
                    <span className="text-xs">HRV</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{healthData.hrv_avg}ms</span>
                </div>
              )}
              {healthData.active_energy != null && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)]">
                    <Activity className="w-3.5 h-3.5" />
                    <span className="text-xs">Steps</span>
                  </div>
                  <span className="text-sm font-semibold text-white">{healthData.active_energy.toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-3xl font-bold text-[var(--text-muted)]">—</div>
              <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-[var(--gold)] hover:opacity-80 transition-opacity">
                <Settings className="w-3 h-3" /> Set up iOS Shortcut
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className={`${CARD} p-5`}>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-4">7-day spending</h3>
          {chartData.some(d => d.spend > 0) ? (
            <div className="h-44">
              <Bar
                data={{
                  labels: chartData.map(d => d.label),
                  datasets: [{ data: chartData.map(d => d.spend), backgroundColor: "#C9A84C", borderRadius: 4, borderSkipped: false }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `$${(ctx.parsed.y ?? 0).toFixed(2)}` } } },
                  scales: {
                    x: { grid: { display: false }, ticks: { color: "#71717a", font: { size: 11 } }, border: { display: false } },
                    y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#71717a", font: { size: 11 }, callback: v => `$${v}` }, border: { display: false } },
                  },
                }}
              />
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-[var(--text-muted)] text-sm">No spending data yet</div>
          )}
        </div>

        <div className={`${CARD} p-5`}>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-4">Spending by category</h3>
          {categoryData.length > 0 ? (
            <div className="flex items-center gap-4 h-44">
              <div className="flex-1 h-full">
                <Doughnut
                  data={{
                    labels: categoryData.map(d => d.name),
                    datasets: [{
                      data: categoryData.map(d => d.value),
                      backgroundColor: categoryData.map(d => CATEGORY_COLORS[d.name] || "#71717a"),
                      borderWidth: 0,
                      hoverOffset: 4,
                    }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false, cutout: "60%",
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` $${(ctx.parsed ?? 0).toFixed(2)}` } } },
                  }}
                />
              </div>
              <div className="space-y-1.5 shrink-0">
                {categoryData.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[d.name] || "#71717a" }} />
                    <span className="text-xs text-[var(--text-dim)] w-20 truncate">{d.name}</span>
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">${d.value.toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-[var(--text-muted)] text-sm">No category data yet</div>
          )}
        </div>
      </div>

      {/* ── Bottom row: bank status + setup checklist ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Bank status */}
        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Bank</span>
            {plaidItems.length > 0 && (
              <button
                onClick={syncTransactions}
                disabled={syncing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[var(--text-dim)] disabled:opacity-40 transition-colors"
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

        {/* Setup checklist — hide when everything is done */}
        {!setupComplete && (
          <div className={`${CARD} p-5`}>
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] block mb-4">Setup</span>
            <ul className="space-y-3">
              {[
                { done: plaidItems.length > 0, label: "Connect bank account" },
                { done: !!healthData, label: "Sync health data via iOS Shortcut" },
                { done: !!behavioralInsight, label: "Calculate first risk score" },
              ].map(({ done, label }) => (
                <li key={label} className="flex items-center gap-2.5">
                  {done
                    ? <CheckCircle className="w-4 h-4 text-[var(--safe)] shrink-0" />
                    : <Circle className="w-4 h-4 text-[var(--text-muted)] shrink-0" />}
                  <span className={`text-sm ${done ? "text-[var(--text-dim)] line-through" : "text-[var(--text-dim)]"}`}>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

    </AppShell>
  );
}
