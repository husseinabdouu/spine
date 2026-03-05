"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import AppShell from "@/components/AppShell";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Chart } from "react-chartjs-2";
import { format, subDays } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import { Activity, Moon, Heart, Zap, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, LineController, Filler, Tooltip, Legend);

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthRow = {
  date:                 string;
  sleep_hours:          number | null;
  sleep_quality:        string | null;
  hrv_avg:              number | null;
  active_energy:        number | null;
  whoop_recovery_score: number | null;
  whoop_strain:         number | null;
  whoop_sleep_score:    number | null;
  source_device:        string | null;
};

type SpendingRow = {
  posted_at:    string;
  amount_cents: number;
};

type Range = "1" | "7" | "30" | "60" | "90" | "all";

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD = "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";

const CHART_OPTS = {
  responsive:          true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: "index" as const, intersect: false } },
  scales: {
    x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "rgba(255,255,255,0.35)", maxTicksLimit: 8, font: { size: 11 } } },
    y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "rgba(255,255,255,0.35)", font: { size: 11 } } },
  },
};

function recoveryColor(score: number | null) {
  if (score === null) return "var(--text-muted)";
  if (score >= 67) return "#4ade80";
  if (score >= 34) return "#facc15";
  return "#f87171";
}

function trend(values: (number | null)[]): "up" | "down" | "flat" {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return "flat";
  const recent = valid.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, valid.length);
  const prior  = valid.slice(-14, -7).reduce((a, b) => a + b, 0) / Math.min(7, valid.length);
  if (recent > prior * 1.03) return "up";
  if (recent < prior * 0.97) return "down";
  return "flat";
}

function TrendIcon({ dir }: { dir: "up" | "down" | "flat" }) {
  if (dir === "up")   return <TrendingUp   className="w-3.5 h-3.5 text-[var(--safe)]"   />;
  if (dir === "down") return <TrendingDown className="w-3.5 h-3.5 text-[var(--danger)]" />;
  return                     <Minus        className="w-3.5 h-3.5 text-[var(--text-muted)]" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId,    setUserId]    = useState<string | null>(null);
  const [health,    setHealth]    = useState<HealthRow[]>([]);
  const [spending,  setSpending]  = useState<SpendingRow[]>([]);
  const [range,     setRange]     = useState<Range>("7");
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);

  useEffect(() => { init(); }, []);
  useEffect(() => { if (userId) loadData(userId, range); }, [userId, range]);

  async function init() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    setUserEmail(data.session.user.email ?? null);
    setUserId(data.session.user.id);
  }

  async function loadData(uid: string, r: Range) {
    setLoading(true);
    const fromDate = r === "all"
      ? "2000-01-01"
      : format(subDays(new Date(), r === "1" ? 1 : parseInt(r)), "yyyy-MM-dd");

    const [{ data: hData }, { data: sData }] = await Promise.all([
      supabase
        .from("health_data")
        .select("date,sleep_hours,sleep_quality,hrv_avg,active_energy,whoop_recovery_score,whoop_strain,whoop_sleep_score,source_device")
        .eq("user_id", uid)
        .gte("date", fromDate)
        .order("date", { ascending: true }),
      supabase
        .from("transactions")
        .select("posted_at,amount_cents")
        .eq("user_id", uid)
        .gte("posted_at", fromDate)
        .gt("amount_cents", 0),
    ]);

    setHealth(hData ?? []);
    setSpending(sData ?? []);
    setLoading(false);
  }

  function logout() { supabase.auth.signOut().then(() => router.push("/setup")); }

  async function refreshToday() {
    if (!userId || syncing) return;
    setSyncing(true);
    const today     = format(new Date(), "yyyy-MM-dd");
    const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
    // Sync both today and yesterday (Whoop strain/HRV update throughout the day;
    // yesterday's recovery score may also have been updated since last sync)
    await Promise.allSettled([
      fetch("/api/whoop/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, date: today }),
      }),
      fetch("/api/whoop/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ user_id: userId, date: yesterday }),
      }),
    ]);
    await loadData(userId, range);
    setSyncing(false);
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const latest = health.at(-1) ?? null;
  const labels  = health.map(h => format(parseLocalDate(h.date), "MMM d"));

  // Helper: average of non-null values
  function avg(vals: (number | null)[]): number | null {
    const v = vals.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }

  // Daily spending totals keyed by date
  const spendByDate: Record<string, number> = {};
  for (const tx of spending) {
    const d = tx.posted_at.slice(0, 10);
    spendByDate[d] = (spendByDate[d] ?? 0) + tx.amount_cents / 100;
  }
  const spendSeries = health.map(h => spendByDate[h.date] ?? 0);

  const recoveryData = health.map(h => h.whoop_recovery_score);
  const hrvData      = health.map(h => h.hrv_avg);
  const sleepData    = health.map(h => h.sleep_hours);
  const strainData   = health.map(h => h.whoop_strain);

  // Period averages (used in the metric cards)
  const avgRecovery = avg(recoveryData);
  const avgHrv      = avg(hrvData);
  const avgSleep    = avg(sleepData);
  const avgStrain   = avg(strainData);

  const rangeLabelShort = range === "1" ? "today" : range === "7" ? "7d avg" : range === "all" ? "all-time avg" : `${range}d avg`;

  const recoveryTrend = trend(recoveryData);
  const hrvTrend      = trend(hrvData);
  const sleepTrend    = trend(sleepData);
  const strainTrend   = trend(strainData);

  // ── Chart datasets ───────────────────────────────────────────────────────────

  const lineBase = {
    tension:           0.4,
    pointRadius:       2,
    pointHoverRadius:  5,
    borderWidth:       2,
    spanGaps:          true,
  };

  const recoveryChart = {
    labels,
    datasets: [{
      ...lineBase,
      label:           "Recovery %",
      data:            recoveryData,
      borderColor:     "#4ade80",
      backgroundColor: "rgba(74,222,128,0.08)",
      fill:            true,
    }],
  };

  const hrvChart = {
    labels,
    datasets: [{
      ...lineBase,
      label:           "HRV (ms)",
      data:            hrvData,
      borderColor:     "#818cf8",
      backgroundColor: "rgba(129,140,248,0.08)",
      fill:            true,
    }],
  };

  const sleepChart = {
    labels,
    datasets: [{
      ...lineBase,
      label:           "Sleep (hrs)",
      data:            sleepData,
      borderColor:     "#38bdf8",
      backgroundColor: "rgba(56,189,248,0.08)",
      fill:            true,
    }],
  };

  const overlayChart = {
    labels,
    datasets: [
      {
        type:            "line" as const,
        ...lineBase,
        label:           "Recovery %",
        data:            recoveryData,
        borderColor:     "#4ade80",
        backgroundColor: "rgba(74,222,128,0.06)",
        fill:            true,
        yAxisID:         "y",
      },
      {
        type:            "bar" as const,
        label:           "Spending ($)",
        data:            spendSeries,
        backgroundColor: "rgba(201,168,76,0.35)",
        borderColor:     "rgba(201,168,76,0.7)",
        borderWidth:     1,
        yAxisID:         "y1",
      },
    ],
  };

  const overlayOpts = {
    ...CHART_OPTS,
    scales: {
      ...CHART_OPTS.scales,
      y:  { ...CHART_OPTS.scales.y, position: "left"  as const, title: { display: true, text: "Recovery %", color: "rgba(255,255,255,0.3)", font: { size: 10 } } },
      y1: { ...CHART_OPTS.scales.y, position: "right" as const, grid: { drawOnChartArea: false }, title: { display: true, text: "Spending $", color: "rgba(255,255,255,0.3)", font: { size: 10 } } },
    },
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!userId) return null;

  return (
    <AppShell userEmail={userEmail ?? undefined} onLogout={logout}>
      <div className="space-y-6 pb-8">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Health</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {health.length > 0
                ? `${health.length} days of data · last synced ${format(parseLocalDate(health.at(-1)!.date), "MMM d")}`
                : "No health data yet — connect Whoop in Settings"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Range selector */}
            <div className="flex gap-1 bg-white/[0.04] rounded-lg p-1 border border-[var(--border)]">
              {(["1", "7", "30", "60", "90", "all"] as Range[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    range === r
                      ? "bg-[var(--gold)] text-black"
                      : "text-[var(--text-dim)] hover:text-white"
                  }`}
                >
                  {r === "all" ? "All" : r === "1" ? "1d" : r === "7" ? "7d" : `${r}d`}
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <button
              onClick={refreshToday}
              disabled={syncing}
              title="Sync today's Whoop data"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-dim)] hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-[var(--text-muted)]">Loading…</div>
        ) : health.length === 0 ? (
          <div className={`${CARD} p-12 text-center`}>
            <Activity className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-dim)] font-medium mb-1">No health data yet</p>
            <p className="text-sm text-[var(--text-muted)]">
              Connect Whoop in Settings, then run "Backfill all time" to populate your history.
            </p>
          </div>
        ) : (
          <>
            {/* ── Metric cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  label:   "Recovery",
                  primary: avgRecovery != null ? `${Math.round(avgRecovery)}%` : "—",
                  latest:  latest?.whoop_recovery_score != null ? `${Math.round(latest.whoop_recovery_score)}%` : null,
                  sub:     avgRecovery != null
                    ? avgRecovery >= 67 ? "Green zone" : avgRecovery >= 34 ? "Yellow zone" : "Red zone"
                    : "No scored data yet",
                  color:   recoveryColor(avgRecovery),
                  Icon:    Activity,
                  trend:   recoveryTrend,
                },
                {
                  label:   "HRV",
                  primary: avgHrv != null ? `${Math.round(avgHrv)} ms` : "—",
                  latest:  latest?.hrv_avg != null ? `${Math.round(latest.hrv_avg)} ms` : null,
                  sub:     "heart rate variability",
                  color:   "#818cf8",
                  Icon:    Heart,
                  trend:   hrvTrend,
                },
                {
                  label:   "Sleep",
                  primary: avgSleep != null ? `${avgSleep}h` : "—",
                  latest:  latest?.sleep_hours != null ? `${latest.sleep_hours}h` : null,
                  sub:     latest?.whoop_sleep_score != null ? `latest: ${Math.round(latest.whoop_sleep_score)}% perf` : "sleep duration",
                  color:   "#38bdf8",
                  Icon:    Moon,
                  trend:   sleepTrend,
                },
                {
                  label:   "Strain",
                  primary: avgStrain != null ? avgStrain.toFixed(1) : "—",
                  latest:  latest?.whoop_strain != null ? latest.whoop_strain.toFixed(1) : null,
                  sub:     "day strain score",
                  color:   "#fb923c",
                  Icon:    Zap,
                  trend:   strainTrend,
                },
              ].map(({ label, primary, latest: latestVal, sub, color, Icon, trend: t }) => (
                <div key={label} className={`${CARD} p-4`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color }} />
                      <span className="text-xs font-medium text-[var(--text-dim)] uppercase tracking-wider">{label}</span>
                    </div>
                    <TrendIcon dir={t} />
                  </div>
                  <div className="text-2xl font-bold" style={{ color }}>{primary}</div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">{rangeLabelShort}</div>
                  {latestVal && range !== "1" && (
                    <div className="text-xs text-[var(--text-dim)] mt-1">latest: {latestVal}</div>
                  )}
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>
                </div>
              ))}
            </div>

            {/* ── Charts grid (hidden for 1-day view) ── */}
            {health.length > 1 && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Recovery trend */}
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-4 h-4 text-[#4ade80]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">Recovery Score</h3>
                  <TrendIcon dir={recoveryTrend} />
                </div>
                <div className="h-48">
                  <Line data={recoveryChart} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, min: 0, max: 100 } } }} />
                </div>
              </div>

              {/* HRV trend */}
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-2 mb-4">
                  <Heart className="w-4 h-4 text-[#818cf8]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">Heart Rate Variability</h3>
                  <TrendIcon dir={hrvTrend} />
                </div>
                <div className="h-48">
                  <Line data={hrvChart} options={CHART_OPTS} />
                </div>
              </div>

              {/* Sleep trend */}
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-2 mb-4">
                  <Moon className="w-4 h-4 text-[#38bdf8]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">Sleep Duration</h3>
                  <TrendIcon dir={sleepTrend} />
                </div>
                <div className="h-48">
                  <Line data={sleepChart} options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, min: 0, max: 12 } } }} />
                </div>
              </div>

              {/* Recovery vs Spending overlay */}
              <div className={`${CARD} p-5`}>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-[var(--gold)]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">Recovery vs Spending</h3>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-4">Low recovery days often precede spending spikes</p>
                <div className="h-48">
                  <Chart type="bar" data={overlayChart} options={overlayOpts} />
                </div>
              </div>

            </div>}

            {/* ── Recent days table ── */}
            <div className={`${CARD} p-5`}>
              <h3 className="text-sm font-semibold text-[var(--text)] mb-4">
                {range === "1" ? "Today" : range === "7" ? "Last 7 Days" : "Recent Days"}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)]">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Recovery</th>
                      <th className="pb-2 pr-4">HRV</th>
                      <th className="pb-2 pr-4">Sleep</th>
                      <th className="pb-2 pr-4">Strain</th>
                      <th className="pb-2">Spent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {[...health].reverse().slice(0, range === "1" ? 2 : range === "7" ? 7 : 14).map(row => {
                      const rec = row.whoop_recovery_score;
                      const daySpend = spendByDate[row.date] ?? 0;
                      return (
                        <tr key={row.date} className="text-[var(--text-dim)] hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 pr-4 font-medium text-[var(--text)]">
                            {format(parseLocalDate(row.date), "MMM d")}
                          </td>
                          <td className="py-2.5 pr-4">
                            {rec != null ? (
                              <span className="font-semibold" style={{ color: recoveryColor(rec) }}>
                                {Math.round(rec)}%
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-2.5 pr-4">{row.hrv_avg != null ? `${Math.round(row.hrv_avg)} ms` : "—"}</td>
                          <td className="py-2.5 pr-4">{row.sleep_hours != null ? `${row.sleep_hours}h` : "—"}</td>
                          <td className="py-2.5 pr-4">{row.whoop_strain != null ? row.whoop_strain.toFixed(1) : "—"}</td>
                          <td className="py-2.5">
                            {daySpend > 0
                              ? <span className="text-[var(--gold)]">${daySpend.toFixed(0)}</span>
                              : <span className="text-[var(--text-muted)]">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </>
        )}
      </div>
    </AppShell>
  );
}
