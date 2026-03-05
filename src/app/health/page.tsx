"use client";

import { useEffect, useState, useCallback } from "react";
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
import { format, subDays, parseISO } from "date-fns";
import { parseLocalDate } from "@/lib/dateUtils";
import {
  Activity, Moon, Heart, Zap, RefreshCw, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, Flame, Wind,
} from "lucide-react";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, BarController, LineController, Filler, Tooltip, Legend,
);

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthRow = {
  date:                 string;
  sleep_hours:          number | null;
  sleep_quality:        string | null;
  hrv_avg:              number | null;
  resting_heart_rate:   number | null;
  active_energy:        number | null;
  whoop_calories:       number | null;
  whoop_rem_mins:       number | null;
  whoop_deep_mins:      number | null;
  whoop_light_mins:     number | null;
  whoop_recovery_score: number | null;
  whoop_strain:         number | null;
  whoop_sleep_score:    number | null;
  source_device:        string | null;
};

type SpendingRow = { posted_at: string; amount_cents: number };
type Range = "1" | "7" | "30" | "60" | "90" | "all";
type Tab   = "overview" | "sleep" | "recovery" | "strain";

const CARD = "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";

const BASE_CHART = {
  responsive:          true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: "index" as const, intersect: false } },
  scales: {
    x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "rgba(255,255,255,0.3)", maxTicksLimit: 8, font: { size: 10 } } },
    y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "rgba(255,255,255,0.3)", font: { size: 10 } } },
  },
};

function rColor(v: number | null) {
  if (v === null) return "var(--text-muted)";
  if (v >= 67) return "#4ade80";
  if (v >= 34) return "#facc15";
  return "#f87171";
}

function avg(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

function trendDir(vals: (number | null)[]): "up" | "down" | "flat" {
  const v = vals.filter((x): x is number => x !== null);
  if (v.length < 4) return "flat";
  const half    = Math.floor(v.length / 2);
  const recent  = v.slice(-half).reduce((a, b) => a + b, 0) / half;
  const earlier = v.slice(0, half).reduce((a, b) => a + b, 0) / half;
  if (recent > earlier * 1.03) return "up";
  if (recent < earlier * 0.97) return "down";
  return "flat";
}

function TrendBadge({ dir }: { dir: "up" | "down" | "flat" }) {
  if (dir === "up")   return <TrendingUp   className="w-3.5 h-3.5 text-[var(--safe)]"   />;
  if (dir === "down") return <TrendingDown className="w-3.5 h-3.5 text-[var(--danger)]" />;
  return                     <Minus        className="w-3.5 h-3.5 text-[var(--text-muted)]" />;
}

function line(label: string, data: (number | null)[], color: string, fill = true) {
  return {
    type: "line" as const,
    label,
    data,
    borderColor:     color,
    backgroundColor: fill ? color.replace(")", ",0.08)").replace("rgb", "rgba") : "transparent",
    fill,
    tension:          0.4,
    pointRadius:      2,
    pointHoverRadius: 5,
    borderWidth:      2,
    spanGaps:         true,
  };
}

function bar(label: string, data: (number | null)[], color: string) {
  return {
    type:            "bar" as const,
    label,
    data,
    backgroundColor: color,
    borderRadius:    3,
  };
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color = "var(--text)" }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <span className="text-lg font-bold" style={{ color }}>{value}</span>
      {sub && <span className="text-[10px] text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId,    setUserId]    = useState<string | null>(null);
  const [health,    setHealth]    = useState<HealthRow[]>([]);
  const [spending,  setSpending]  = useState<SpendingRow[]>([]);
  const [range,     setRange]     = useState<Range>("30");
  const [tab,       setTab]       = useState<Tab>("overview");
  const [dayIdx,    setDayIdx]    = useState<number | null>(null); // null = no day selected
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);

  useEffect(() => { init(); }, []);

  const loadData = useCallback(async (uid: string, r: Range) => {
    setLoading(true);
    const fromDate = r === "all" ? "2000-01-01"
      : r === "1" ? format(new Date(), "yyyy-MM-dd")
      : format(subDays(new Date(), parseInt(r)), "yyyy-MM-dd");

    const [{ data: hData }, { data: sData }] = await Promise.all([
      supabase
        .from("health_data")
        .select("date,sleep_hours,sleep_quality,hrv_avg,resting_heart_rate,active_energy,whoop_calories,whoop_rem_mins,whoop_deep_mins,whoop_light_mins,whoop_recovery_score,whoop_strain,whoop_sleep_score,source_device")
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
    setDayIdx(null);
    setLoading(false);
  }, []);

  async function init() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    const uid = data.session.user.id;
    setUserEmail(data.session.user.email ?? null);
    setUserId(uid);
    await loadData(uid, range);
  }

  useEffect(() => { if (userId) loadData(userId, range); }, [userId, range, loadData]);

  async function refreshToday() {
    if (!userId || syncing) return;
    setSyncing(true);
    const today     = format(new Date(), "yyyy-MM-dd");
    const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
    await Promise.allSettled([
      fetch("/api/whoop/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, date: today }) }),
      fetch("/api/whoop/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, date: yesterday }) }),
    ]);
    await loadData(userId, range);
    setSyncing(false);
  }

  function logout() { supabase.auth.signOut().then(() => router.push("/setup")); }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const labels      = health.map(h => format(parseLocalDate(h.date), "MMM d"));
  const latest      = health.at(-1) ?? null;
  const selectedDay = dayIdx !== null ? health[dayIdx] : null;

  const spendByDate: Record<string, number> = {};
  for (const tx of spending) {
    const d = tx.posted_at.slice(0, 10);
    spendByDate[d] = (spendByDate[d] ?? 0) + tx.amount_cents / 100;
  }

  const recoveryVals = health.map(h => h.whoop_recovery_score);
  const hrvVals      = health.map(h => h.hrv_avg);
  const rhrVals      = health.map(h => h.resting_heart_rate);
  const sleepVals    = health.map(h => h.sleep_hours);
  const strainVals   = health.map(h => h.whoop_strain);
  const calVals      = health.map(h => h.whoop_calories);
  const spendVals    = health.map(h => spendByDate[h.date] ?? 0);
  const remVals      = health.map(h => h.whoop_rem_mins);
  const deepVals     = health.map(h => h.whoop_deep_mins);
  const lightVals    = health.map(h => h.whoop_light_mins);

  const isToday  = range === "1";
  const rangeLbl = isToday ? "today" : range === "all" ? "all-time avg"
    : range === "7" ? "7d avg" : `${range}d avg`;

  // For the "Today" view show direct values, not averages
  const todayRow = isToday ? (health.find(h => h.date === format(new Date(), "yyyy-MM-dd")) ?? health.at(-1) ?? null) : null;
  function displayVal(rangeAvg: number | null, todayField: number | null): number | null {
    return isToday ? todayField : rangeAvg;
  }

  // ─── Charts ──────────────────────────────────────────────────────────────────

  const recoveryChart = { labels, datasets: [line("Recovery %", recoveryVals, "#4ade80")] };
  const hrvChart      = { labels, datasets: [line("HRV ms", hrvVals, "#818cf8"), line("RHR bpm", rhrVals, "#f87171")] };
  const sleepChart    = {
    labels,
    datasets: [
      bar("REM",   remVals,   "rgba(129,140,248,0.7)"),
      bar("Deep",  deepVals,  "rgba(74,222,128,0.7)"),
      bar("Light", lightVals, "rgba(56,189,248,0.5)"),
    ],
  };
  const strainCalChart = {
    labels,
    datasets: [
      line("Strain", strainVals, "#fb923c"),
      { ...bar("Calories", calVals, "rgba(201,168,76,0.4)"), yAxisID: "y1" },
    ],
  };
  const overlayChart = {
    labels,
    datasets: [
      { ...line("Recovery %", recoveryVals, "#4ade80"), yAxisID: "y" },
      { ...bar("Spending $", spendVals, "rgba(201,168,76,0.4)"), yAxisID: "y1" },
    ],
  };

  const dualOpts = (leftLabel: string, rightLabel: string) => ({
    ...BASE_CHART,
    scales: {
      ...BASE_CHART.scales,
      y:  { ...BASE_CHART.scales.y, position: "left"  as const, title: { display: true, text: leftLabel,  color: "rgba(255,255,255,0.25)", font: { size: 10 } } },
      y1: { ...BASE_CHART.scales.y, position: "right" as const, grid: { drawOnChartArea: false }, title: { display: true, text: rightLabel, color: "rgba(255,255,255,0.25)", font: { size: 10 } } },
    },
  });

  const stackedOpts = { ...BASE_CHART, scales: { ...BASE_CHART.scales, x: { ...BASE_CHART.scales.x, stacked: true }, y: { ...BASE_CHART.scales.y, stacked: true } } };

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const RANGES: Range[] = ["1", "7", "30", "60", "90", "all"];
  const TABS: { key: Tab; label: string }[] = [
    { key: "overview",  label: "Overview"  },
    { key: "recovery",  label: "Recovery"  },
    { key: "sleep",     label: "Sleep"     },
    { key: "strain",    label: "Strain"    },
  ];

  if (!userId) return null;

  return (
    <AppShell userEmail={userEmail ?? undefined} onLogout={logout}>
      <div className="space-y-5 pb-8">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Health</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {health.length > 0
                ? `${health.length} days · last synced ${format(parseLocalDate(health.at(-1)!.date), "MMM d")}`
                : "No data — connect Whoop in Settings"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-1 border border-[var(--border)]">
              {RANGES.map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${range === r ? "bg-[var(--gold)] text-black" : "text-[var(--text-dim)] hover:text-white"}`}
                >
                  {r === "all" ? "All" : r === "1" ? "Today" : `${r}d`}
                </button>
              ))}
            </div>
            <button
              onClick={refreshToday}
              disabled={syncing}
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
            <p className="text-sm text-[var(--text-muted)]">Connect Whoop in Settings, then run "Backfill all time".</p>
          </div>
        ) : (
          <>
            {/* ── 8 metric cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Recovery",  val: displayVal(avg(recoveryVals), todayRow?.whoop_recovery_score ?? null), unit: "%",    color: rColor(displayVal(avg(recoveryVals), todayRow?.whoop_recovery_score ?? null)), Icon: Activity, trend: trendDir(recoveryVals) },
                { label: "HRV",       val: displayVal(avg(hrvVals),      todayRow?.hrv_avg              ?? null), unit: " ms",  color: "#818cf8", Icon: Heart,  trend: trendDir(hrvVals) },
                { label: "RHR",       val: displayVal(avg(rhrVals),      todayRow?.resting_heart_rate   ?? null), unit: " bpm", color: "#f87171", Icon: Heart,  trend: trendDir(rhrVals.map(v => v !== null ? -v : null)) },
                { label: "Sleep",     val: displayVal(avg(sleepVals),    todayRow?.sleep_hours          ?? null), unit: "h",    color: "#38bdf8", Icon: Moon,   trend: trendDir(sleepVals) },
                { label: "Strain",    val: displayVal(avg(strainVals),   todayRow?.whoop_strain         ?? null), unit: "",     color: "#fb923c", Icon: Zap,    trend: trendDir(strainVals) },
                { label: "Calories",  val: displayVal(avg(calVals),      todayRow?.whoop_calories       ?? null), unit: " cal", color: "#fbbf24", Icon: Flame,  trend: trendDir(calVals) },
                { label: "REM",       val: displayVal(avg(remVals),      todayRow?.whoop_rem_mins       ?? null), unit: " min", color: "#a78bfa", Icon: Wind,   trend: trendDir(remVals) },
                { label: "Deep",      val: displayVal(avg(deepVals),     todayRow?.whoop_deep_mins      ?? null), unit: " min", color: "#34d399", Icon: Moon,   trend: trendDir(deepVals) },
              ].map(({ label, val, unit, color, Icon, trend }) => (
                <div key={label} className={`${CARD} p-4`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                      <span className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">{label}</span>
                    </div>
                    {!isToday && <TrendBadge dir={trend} />}
                  </div>
                  <div className="text-xl font-bold" style={{ color }}>
                    {val !== null ? `${val}${unit}` : "—"}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{rangeLbl}</div>
                </div>
              ))}
            </div>

            {/* ── Today: full-day detail layout ── */}
            {isToday && todayRow && (
              <div className="space-y-4">
                {/* Recovery */}
                <div className={`${CARD} p-5`}>
                  <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-4">Recovery</p>
                  <div className="flex items-center gap-6 mb-5">
                    {/* Big score ring */}
                    <div className="relative w-20 h-20 shrink-0">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                        <circle
                          cx="40" cy="40" r="32" fill="none"
                          stroke={rColor(todayRow.whoop_recovery_score)}
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 32}`}
                          strokeDashoffset={`${2 * Math.PI * 32 * (1 - (todayRow.whoop_recovery_score ?? 0) / 100)}`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-bold" style={{ color: rColor(todayRow.whoop_recovery_score) }}>
                          {todayRow.whoop_recovery_score != null ? `${Math.round(todayRow.whoop_recovery_score)}` : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 flex-1">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">HRV</p>
                        <p className="text-xl font-bold text-[#818cf8]">{todayRow.hrv_avg != null ? `${Math.round(todayRow.hrv_avg)} ms` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Resting HR</p>
                        <p className="text-xl font-bold text-[#f87171]">{todayRow.resting_heart_rate != null ? `${Math.round(todayRow.resting_heart_rate)} bpm` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Recovery %</p>
                        <p className="text-sm font-semibold" style={{ color: rColor(todayRow.whoop_recovery_score) }}>
                          {todayRow.whoop_recovery_score != null
                            ? todayRow.whoop_recovery_score >= 67 ? "Optimal" : todayRow.whoop_recovery_score >= 34 ? "Moderate" : "Low"
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                  {/* HRV bar */}
                  {todayRow.hrv_avg != null && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                        <span>HRV</span><span>{Math.round(todayRow.hrv_avg)} ms</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#818cf8]" style={{ width: `${Math.min(100, (todayRow.hrv_avg / 120) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Sleep */}
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">Sleep</p>
                    {todayRow.whoop_sleep_score != null && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#38bdf8]/10 text-[#38bdf8]">
                        {Math.round(todayRow.whoop_sleep_score)}% score
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Duration</p>
                      <p className="text-2xl font-bold text-[#38bdf8]">{todayRow.sleep_hours != null ? `${todayRow.sleep_hours}h` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">REM</p>
                      <p className="text-2xl font-bold text-[#a78bfa]">{todayRow.whoop_rem_mins != null ? `${todayRow.whoop_rem_mins}m` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Deep</p>
                      <p className="text-2xl font-bold text-[#34d399]">{todayRow.whoop_deep_mins != null ? `${todayRow.whoop_deep_mins}m` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Light</p>
                      <p className="text-2xl font-bold text-[#38bdf8]/70">{todayRow.whoop_light_mins != null ? `${todayRow.whoop_light_mins}m` : "—"}</p>
                    </div>
                  </div>
                  {/* Sleep stage visual bar */}
                  {(todayRow.whoop_rem_mins != null || todayRow.whoop_deep_mins != null || todayRow.whoop_light_mins != null) && (() => {
                    const rem   = todayRow.whoop_rem_mins   ?? 0;
                    const deep  = todayRow.whoop_deep_mins  ?? 0;
                    const light = todayRow.whoop_light_mins ?? 0;
                    const total = rem + deep + light;
                    if (total === 0) return null;
                    return (
                      <div className="space-y-2">
                        <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                          {rem   > 0 && <div className="h-full bg-[#a78bfa]" style={{ width: `${(rem   / total) * 100}%` }} />}
                          {deep  > 0 && <div className="h-full bg-[#34d399]" style={{ width: `${(deep  / total) * 100}%` }} />}
                          {light > 0 && <div className="h-full bg-[#38bdf8]/60" style={{ width: `${(light / total) * 100}%` }} />}
                        </div>
                        <div className="flex gap-4 text-[10px] text-[var(--text-muted)]">
                          <span><span className="text-[#a78bfa]">■</span> REM {Math.round((rem / total) * 100)}%</span>
                          <span><span className="text-[#34d399]">■</span> Deep {Math.round((deep / total) * 100)}%</span>
                          <span><span className="text-[#38bdf8]/60">■</span> Light {Math.round((light / total) * 100)}%</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Activity */}
                <div className={`${CARD} p-5`}>
                  <p className="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-4">Activity</p>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Strain</p>
                      <p className="text-3xl font-bold text-[#fb923c]">{todayRow.whoop_strain != null ? todayRow.whoop_strain.toFixed(1) : "—"}</p>
                      {todayRow.whoop_strain != null && (
                        <div className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#fb923c]" style={{ width: `${(todayRow.whoop_strain / 21) * 100}%` }} />
                        </div>
                      )}
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">out of 21</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Calories</p>
                      <p className="text-3xl font-bold text-[#fbbf24]">{todayRow.whoop_calories != null ? `${todayRow.whoop_calories.toLocaleString()}` : "—"}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">kcal burned</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab bar (multi-day ranges only) ── */}
            {!isToday && health.length > 1 && (
              <>
                <div className="flex gap-1 border-b border-[var(--border)]">
                  {TABS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === key ? "border-[var(--gold)] text-white" : "border-transparent text-[var(--text-muted)] hover:text-white"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Overview tab ── */}
                {tab === "overview" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">Recovery Score</p>
                      <div className="h-48"><Line data={recoveryChart} options={{ ...BASE_CHART, scales: { ...BASE_CHART.scales, y: { ...BASE_CHART.scales.y, min: 0, max: 100 } } }} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-1">HRV &amp; Resting HR</p>
                      <p className="text-xs text-[var(--text-muted)] mb-4"><span className="text-[#818cf8]">■</span> HRV &nbsp; <span className="text-[#f87171]">■</span> RHR</p>
                      <div className="h-48"><Line data={hrvChart} options={BASE_CHART} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-1">Recovery vs Spending</p>
                      <p className="text-xs text-[var(--text-muted)] mb-4">Low recovery days often precede spending spikes</p>
                      <div className="h-48"><Chart type="bar" data={overlayChart} options={dualOpts("Recovery %", "Spending $")} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-1">Strain &amp; Calories</p>
                      <p className="text-xs text-[var(--text-muted)] mb-4"><span className="text-[#fb923c]">■</span> Strain &nbsp; <span className="text-[#fbbf24]">■</span> Calories</p>
                      <div className="h-48"><Chart type="bar" data={strainCalChart} options={dualOpts("Strain", "Calories")} /></div>
                    </div>
                  </div>
                )}

                {/* ── Recovery tab ── */}
                {tab === "recovery" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">Recovery Score</p>
                      <div className="h-52"><Line data={recoveryChart} options={{ ...BASE_CHART, scales: { ...BASE_CHART.scales, y: { ...BASE_CHART.scales.y, min: 0, max: 100 } } }} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">HRV &amp; Resting HR</p>
                      <div className="h-52"><Line data={hrvChart} options={BASE_CHART} /></div>
                    </div>
                  </div>
                )}

                {/* ── Sleep tab ── */}
                {tab === "sleep" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">Total Sleep Duration</p>
                      <div className="h-52"><Line data={{ labels, datasets: [line("Sleep hrs", sleepVals, "#38bdf8")] }} options={{ ...BASE_CHART, scales: { ...BASE_CHART.scales, y: { ...BASE_CHART.scales.y, min: 0, max: 12 } } }} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-1">Sleep Stages</p>
                      <p className="text-xs text-[var(--text-muted)] mb-4"><span className="text-[#a78bfa]">■</span> REM &nbsp; <span className="text-[#34d399]">■</span> Deep &nbsp; <span className="text-[#38bdf8]">■</span> Light</p>
                      <div className="h-52"><Chart type="bar" data={sleepChart} options={stackedOpts} /></div>
                    </div>
                  </div>
                )}

                {/* ── Strain tab ── */}
                {tab === "strain" && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">Daily Strain</p>
                      <div className="h-52"><Line data={{ labels, datasets: [line("Strain", strainVals, "#fb923c")] }} options={BASE_CHART} /></div>
                    </div>
                    <div className={`${CARD} p-5`}>
                      <p className="text-sm font-semibold text-[var(--text)] mb-4">Calories Burned</p>
                      <div className="h-52"><Chart type="bar" data={{ labels, datasets: [bar("Calories", calVals, "rgba(251,191,36,0.6)")] }} options={BASE_CHART} /></div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Day-by-day log (multi-day only) ── */}
            {!isToday && (
            <div className={`${CARD} overflow-hidden`}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                <h3 className="text-sm font-semibold text-[var(--text)]">Daily Log</h3>
                {selectedDay && (
                  <button onClick={() => setDayIdx(null)} className="text-xs text-[var(--text-muted)] hover:text-white transition-colors">
                    ← Back to list
                  </button>
                )}
              </div>

              {/* Single day detail */}
              {selectedDay ? (
                <div className="p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setDayIdx(d => d! > 0 ? d! - 1 : d)} disabled={dayIdx === 0} className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-dim)] hover:text-white disabled:opacity-30 transition-colors">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <h4 className="text-base font-semibold text-white">
                      {format(parseLocalDate(selectedDay.date), "EEEE, MMMM d yyyy")}
                    </h4>
                    <button onClick={() => setDayIdx(d => d! < health.length - 1 ? d! + 1 : d)} disabled={dayIdx === health.length - 1} className="p-1.5 rounded-lg border border-[var(--border)] text-[var(--text-dim)] hover:text-white disabled:opacity-30 transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Recovery */}
                  <div className={`${CARD} p-4`}>
                    <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-3">Recovery</p>
                    <div className="grid grid-cols-3 gap-4">
                      <Stat label="Score" value={selectedDay.whoop_recovery_score != null ? `${Math.round(selectedDay.whoop_recovery_score)}%` : "—"} color={rColor(selectedDay.whoop_recovery_score)} />
                      <Stat label="HRV" value={selectedDay.hrv_avg != null ? `${Math.round(selectedDay.hrv_avg)} ms` : "—"} color="#818cf8" />
                      <Stat label="Resting HR" value={selectedDay.resting_heart_rate != null ? `${Math.round(selectedDay.resting_heart_rate)} bpm` : "—"} color="#f87171" />
                    </div>
                  </div>

                  {/* Sleep */}
                  <div className={`${CARD} p-4`}>
                    <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-3">Sleep</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
                      <Stat label="Duration" value={selectedDay.sleep_hours != null ? `${selectedDay.sleep_hours}h` : "—"} color="#38bdf8" />
                      <Stat label="Score" value={selectedDay.whoop_sleep_score != null ? `${Math.round(selectedDay.whoop_sleep_score)}%` : "—"} />
                      <Stat label="REM" value={selectedDay.whoop_rem_mins != null ? `${selectedDay.whoop_rem_mins}m` : "—"} color="#a78bfa" />
                      <Stat label="Deep" value={selectedDay.whoop_deep_mins != null ? `${selectedDay.whoop_deep_mins}m` : "—"} color="#34d399" />
                      <Stat label="Light" value={selectedDay.whoop_light_mins != null ? `${selectedDay.whoop_light_mins}m` : "—"} color="#38bdf8" />
                      <Stat label="Quality" value={selectedDay.sleep_quality ?? "—"} />
                    </div>
                  </div>

                  {/* Strain */}
                  <div className={`${CARD} p-4`}>
                    <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-3">Activity</p>
                    <div className="grid grid-cols-3 gap-4">
                      <Stat label="Strain" value={selectedDay.whoop_strain != null ? selectedDay.whoop_strain.toFixed(1) : "—"} color="#fb923c" />
                      <Stat label="Calories" value={selectedDay.whoop_calories != null ? `${selectedDay.whoop_calories} cal` : "—"} color="#fbbf24" />
                      <Stat label="Spending" value={spendByDate[selectedDay.date] ? `$${spendByDate[selectedDay.date].toFixed(0)}` : "—"} color="var(--gold)" />
                    </div>
                  </div>
                </div>
              ) : (
                // Day list
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                        <th className="px-5 py-3">Date</th>
                        <th className="px-3 py-3">Recovery</th>
                        <th className="px-3 py-3">HRV</th>
                        <th className="px-3 py-3">RHR</th>
                        <th className="px-3 py-3">Sleep</th>
                        <th className="px-3 py-3">Strain</th>
                        <th className="px-3 py-3">Calories</th>
                        <th className="px-3 py-3">Spent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {[...health].reverse().map((row, i) => {
                        const realIdx = health.length - 1 - i;
                        const daySpend = spendByDate[row.date] ?? 0;
                        return (
                          <tr
                            key={row.date}
                            onClick={() => setDayIdx(realIdx)}
                            className="text-[var(--text-dim)] hover:bg-white/[0.03] cursor-pointer transition-colors"
                          >
                            <td className="px-5 py-2.5 font-medium text-[var(--text)] whitespace-nowrap">
                              {format(parseLocalDate(row.date), "MMM d, yyyy")}
                            </td>
                            <td className="px-3 py-2.5">
                              {row.whoop_recovery_score != null
                                ? <span className="font-semibold" style={{ color: rColor(row.whoop_recovery_score) }}>{Math.round(row.whoop_recovery_score)}%</span>
                                : "—"}
                            </td>
                            <td className="px-3 py-2.5">{row.hrv_avg != null ? `${Math.round(row.hrv_avg)}` : "—"}</td>
                            <td className="px-3 py-2.5">{row.resting_heart_rate != null ? `${Math.round(row.resting_heart_rate)}` : "—"}</td>
                            <td className="px-3 py-2.5">{row.sleep_hours != null ? `${row.sleep_hours}h` : "—"}</td>
                            <td className="px-3 py-2.5">{row.whoop_strain != null ? row.whoop_strain.toFixed(1) : "—"}</td>
                            <td className="px-3 py-2.5">{row.whoop_calories != null ? row.whoop_calories : "—"}</td>
                            <td className="px-3 py-2.5">
                              {daySpend > 0 ? <span className="text-[var(--gold)]">${daySpend.toFixed(0)}</span> : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}

          </>
        )}
      </div>
    </AppShell>
  );
}
