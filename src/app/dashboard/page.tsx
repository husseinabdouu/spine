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

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);
import { format, subDays } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import { ArrowLeftRight, CreditCard, Activity, Moon, Heart } from "lucide-react";

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
  created_at: string;
};

type BehavioralInsight = {
  id: string;
  date: string;
  risk_score: number;
  insights: string[];
  health_summary: {
    avg_sleep: string;
    avg_hrv: string;
    avg_activity: string;
  };
  spending_summary: {
    last_7_days: string;
    prev_7_days: string;
    change_percent: string;
  };
  created_at: string;
};

export default function DashboardPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [weeklySpend, setWeeklySpend] = useState(0);
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [behavioralInsight, setBehavioralInsight] =
    useState<BehavioralInsight | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      router.push("/setup");
      return;
    }

    setUserEmail(data.session.user.email || null);
    setAuthChecked(true);

    Promise.all([
      loadDashboardData(),
      loadPlaidItems(),
      loadHealthData(),
      loadBehavioralInsights(),
    ]);
  }

  async function loadDashboardData() {
    const thirtyDaysAgo = subDays(new Date(), 30);
    const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("transactions")
      .select("amount_cents, posted_at, category")
      .gte("posted_at", dateStr)
      .order("posted_at", { ascending: false });

    if (!error && data) {
      setTransactions(data);
      const last7 = data.filter(
        (t) => t.posted_at >= subDays(new Date(), 7).toISOString().split("T")[0]
      );
      const total = last7.reduce((sum, t) => sum + Math.abs(t.amount_cents || 0), 0);
      setWeeklySpend(total / 100);
    }
  }

  const chartData = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];
    const last7 = transactions.filter((t) => t.posted_at >= dateStr);
    const byDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const ds = format(d, "yyyy-MM-dd");
      byDay[ds] = 0;
    }
    last7.forEach((t) => {
      const ds = String(t.posted_at).slice(0, 10);
      if (ds in byDay) byDay[ds] += Math.abs(t.amount_cents || 0) / 100;
    });
    return Object.entries(byDay).map(([date, spend]) => ({
      date,
      spend,
      label: format(parseLocalDate(date), "EEE"),
    }));
  }, [transactions]);

  const categoryData = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];
    const last7 = transactions.filter((t) => t.posted_at >= dateStr);
    const byCat: Record<string, number> = {};
    last7.forEach((t) => {
      const cat = t.category || "Uncategorized";
      byCat[cat] = (byCat[cat] || 0) + Math.abs(t.amount_cents || 0) / 100;
    });
    return Object.entries(byCat)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [transactions]);

  const CHART_COLORS = [
    "#C9A84C", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4",
  ];

  async function loadPlaidItems() {
    const { data, error } = await supabase
      .from("plaid_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setPlaidItems(data);
    }
  }

  async function loadHealthData() {
    const { data, error } = await supabase
      .from("health_data")
      .select("*")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      setHealthData(data);
    }
  }

  async function loadBehavioralInsights() {
    const { data, error } = await supabase
      .from("behavioral_insights")
      .select("*")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      setBehavioralInsight(data);
    }
  }

  async function calculateBehavioralRisk() {
    setCalculating(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast("Not logged in", "error");
        setCalculating(false);
        return;
      }

      const response = await fetch("/api/insights/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });

      const data = await response.json();

      if (data.success) {
        toast("Behavioral risk calculated successfully!", "success");
        loadBehavioralInsights();
      } else {
        toast("Error: " + data.error, "error");
      }
    } catch (error) {
      console.error("Calculate error:", error);
      toast("Failed to calculate behavioral risk", "error");
    }

    setCalculating(false);
  }

  async function syncTransactions() {
    setSyncing(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast("Not logged in", "error");
        setSyncing(false);
        return;
      }

      const response = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          force_resync: transactions.length === 0,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const msg =
          data.transactions_added > 0
            ? `Synced! Added ${data.transactions_added} new transactions.`
            : "Synced. No new transactions yet. Plaid may still be fetching your history — try again in a few minutes.";
        toast(msg, "success");
        loadDashboardData();
      } else {
        toast("Error syncing transactions: " + data.error, "error");
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast("Failed to sync transactions", "error");
    }

    setSyncing(false);
  }

  function handlePlaidSuccess() {
    toast("Bank connected! Fetching your full transaction history…", "success");
    loadPlaidItems();
    syncTransactions();
  }

  async function disconnectBank(itemId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setDisconnecting(itemId);
    try {
      const res = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, item_id: itemId }),
      });
      const data = await res.json();
      if (data.success) {
        toast("Bank disconnected. Your transaction history is still saved.", "info");
        loadPlaidItems();
      } else {
        toast(data.error || "Failed to disconnect bank", "error");
      }
    } catch {
      toast("Failed to disconnect bank", "error");
    }
    setDisconnecting(null);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
  }

  function getRiskColor(score: number) {
    if (score <= 30) return "#10b981"; // Green - Low
    if (score <= 60) return "#f59e0b"; // Orange - Medium
    return "#ef4444"; // Red - High
  }

  function getRiskLevel(score: number) {
    if (score <= 30) return "LOW";
    if (score <= 60) return "MEDIUM";
    return "HIGH";
  }

  if (!authChecked) {
    return (
      <AppShell userEmail={null} onLogout={undefined}>
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="animate-pulse text-[var(--text-dim)]">Loading...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell userEmail={userEmail} onLogout={logout}>
      {/* Bank Connection Section */}
      <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 mb-6 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Bank Connections</h3>
          {plaidItems.length === 0 ? (
            <div>
              <p className="text-[var(--text-dim)] mb-4">Connect your bank to sync transactions.</p>
              <PlaidLink onSuccess={handlePlaidSuccess} />
            </div>
          ) : (
            <div className="space-y-3">
              {plaidItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-white/[0.03] border border-[var(--border)] rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--safe-dim)] flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-[var(--safe)]" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--text)]">{item.institution_name}</div>
                      <div className="text-xs text-[var(--text-muted)]">Connected</div>
                    </div>
                  </div>
                  <button
                    onClick={() => disconnectBank(item.id)}
                    disabled={disconnecting === item.id}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors disabled:opacity-50 px-2 py-1"
                  >
                    {disconnecting === item.id ? "Removing…" : "Disconnect"}
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={syncTransactions}
                  disabled={syncing}
                  className="px-4 py-2 bg-[var(--gold)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-[#080808] rounded-lg text-sm font-bold transition-colors"
                >
                  {syncing ? "Syncing…" : "Sync Transactions"}
                </button>
                <PlaidLink onSuccess={handlePlaidSuccess} />
              </div>
            </div>
          )}
        </div>

      {/* Risk + Health + Spending row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Behavioral Risk */}
        <div
          className={`rounded-xl p-5 border bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ${
            behavioralInsight ? "" : ""
          }`}
            style={
              behavioralInsight
                ? { borderLeftWidth: 4, borderLeftColor: getRiskColor(behavioralInsight.risk_score) }
                : undefined
            }
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Behavioral Risk</h3>
              <button
                onClick={calculateBehavioralRisk}
                disabled={calculating}
                className="text-xs px-3 py-1.5 bg-[var(--gold)] hover:opacity-90 disabled:opacity-50 text-[#080808] font-semibold rounded-lg transition-colors"
              >
                {calculating ? "..." : "Recalculate"}
              </button>
            </div>
            {behavioralInsight ? (
              <>
                <div
                  className="text-4xl font-bold"
                  style={{ color: getRiskColor(behavioralInsight.risk_score) }}
                >
                  {behavioralInsight.risk_score}
                  <span className="text-lg font-normal ml-2 text-[var(--text-dim)]">
                    {getRiskLevel(behavioralInsight.risk_score)}
                  </span>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-[var(--text-dim)]">
                  {behavioralInsight.insights.slice(0, 2).map((insight, idx) => (
                    <li key={idx}>• {insight}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[var(--text-muted)] text-sm">Calculate to see your risk score.</p>
            )}
          </div>

        {/* Health */}
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Today&apos;s Health</h3>
            {healthData ? (
              <div className="space-y-3">
                {healthData.sleep_hours != null && (
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-[var(--text-muted)]" />
                    <span className="text-white font-medium">{healthData.sleep_hours.toFixed(1)}h</span>
                    <span className="text-zinc-500 text-sm">sleep</span>
                  </div>
                )}
                {healthData.hrv_avg != null && (
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-[var(--text-muted)]" />
                    <span className="text-white font-medium">{healthData.hrv_avg}ms</span>
                    <span className="text-[var(--text-muted)] text-sm">HRV</span>
                  </div>
                )}
                {healthData.active_energy != null && (
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--text-muted)]" />
                    <span className="text-white font-medium">{healthData.active_energy.toLocaleString()}</span>
                    <span className="text-[var(--text-muted)] text-sm">activity</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[var(--text-muted)] text-sm">Sync health data via iOS Shortcut.</p>
            )}
          </div>

        {/* Weekly Spend */}
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">This Week</h3>
            <div className="text-3xl font-bold text-white">
              ${weeklySpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[var(--text-muted)] text-sm mt-1">{transactions.filter((t) => t.posted_at >= subDays(new Date(), 7).toISOString().split("T")[0]).length} transactions</p>
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-[var(--gold)] hover:opacity-90 text-sm mt-2"
            >
              View all <ArrowLeftRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">7-day spending</h3>
            {chartData.some((d) => d.spend > 0) ? (
              <div className="h-48">
                <Bar
                  data={{
                    labels: chartData.map((d) => d.label),
                    datasets: [{
                      data: chartData.map((d) => d.spend),
                      backgroundColor: "#C9A84C",
                      borderRadius: 4,
                      borderSkipped: false,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `$${(ctx.parsed.y ?? 0).toFixed(2)}` } } },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: "#71717a", font: { size: 11 } }, border: { display: false } },
                      y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#71717a", font: { size: 11 }, callback: (v) => `$${v}` }, border: { display: false } },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No spending data yet</div>
            )}
          </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">Spending by category</h3>
            {categoryData.length > 0 ? (
              <div className="h-48">
                <Doughnut
                  data={{
                    labels: categoryData.map((d) => d.name),
                    datasets: [{
                      data: categoryData.map((d) => d.value),
                      backgroundColor: CHART_COLORS,
                      borderWidth: 0,
                      hoverOffset: 4,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "55%",
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: { label: (ctx) => ` $${(ctx.parsed ?? 0).toFixed(2)}` } },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-[var(--text-muted)] text-sm">No category data yet</div>
            )}
          </div>
        </div>

      {/* Net worth placeholder + setup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--glass-bg)] border border-dashed border-[var(--glass-border)] rounded-xl p-6 flex flex-col items-center justify-center min-h-[120px]">
            <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">Net worth</h3>
            <p className="text-[var(--text-muted)] text-sm text-center">
              Coming soon. Requires Plaid Balance product.
            </p>
          </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Setup</h3>
            <ul className="space-y-2 text-sm">
              <li className={plaidItems.length > 0 ? "text-[var(--safe)]" : "text-[var(--text-muted)]"}>
                {plaidItems.length > 0 ? "✓" : "○"} Bank connected
              </li>
              <li className={healthData ? "text-[var(--safe)]" : "text-[var(--text-muted)]"}>
                {healthData ? "✓" : "○"} Health data synced
              </li>
              <li className={behavioralInsight ? "text-[var(--safe)]" : "text-[var(--text-muted)]"}>
                {behavioralInsight ? "✓" : "○"} Behavioral risk calculated
              </li>
              <li className="text-[var(--text-muted)]">○ Use app 14 days to refine</li>
            </ul>
          </div>
        </div>
    </AppShell>
  );
}
