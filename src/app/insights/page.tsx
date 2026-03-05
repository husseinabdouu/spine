"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import AppShell from "@/components/AppShell";
import ReactMarkdown from "react-markdown";
import { Moon, Heart, Activity, Send, RefreshCw } from "lucide-react";

interface Message {
  role: "user" | "backbone";
  content: string;
}

interface BehavioralInsight {
  date: string;
  risk_score: number;
  insights: string[];
  health_summary: { avg_sleep: string; avg_hrv: string; avg_activity: string };
  spending_summary: { last_7_days: string; prev_7_days: string; change_percent: string };
}

interface HealthData {
  date: string;
  sleep_hours: number | null;
  hrv_avg: number | null;
  active_energy: number | null;
}

const SUGGESTED = [
  "What's my behavioral tax this month?",
  "When am I most likely to overspend?",
  "How does my sleep affect my spending?",
  "What's my biggest spending trigger?",
  "How much would better sleep save me?",
];

function getRiskColor(score: number) {
  if (score <= 30) return "#22c55e";
  if (score <= 60) return "#f59e0b";
  return "#ef4444";
}

function getRiskLabel(score: number) {
  if (score <= 30) return "LOW RISK";
  if (score <= 60) return "MEDIUM RISK";
  return "HIGH RISK";
}

function getInsightSeverityColor(insight: string) {
  if (insight.startsWith("Good")) return "text-[var(--safe)]";
  if (insight.startsWith("Caution") || insight.startsWith("Notice")) return "text-[var(--warn)]";
  if (insight.startsWith("Warning") || insight.startsWith("Alert") || insight.startsWith("Critical")) return "text-[var(--danger)]";
  if (insight.includes("LOW RISK")) return "text-[var(--safe)]";
  if (insight.includes("MEDIUM RISK")) return "text-[var(--warn)]";
  if (insight.includes("HIGH RISK")) return "text-[var(--danger)]";
  return "text-[var(--text-dim)]";
}

function RiskGauge({ score }: { score: number }) {
  const color = getRiskColor(score);
  const r = 54;
  const cx = 70;
  const cy = 68;
  const arcLen = Math.PI * r;
  const filled = (score / 100) * arcLen;

  return (
    <svg viewBox="0 0 140 80" className="w-full max-w-[200px] mx-auto">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={arcLen}
        strokeDashoffset={arcLen - filled}
        style={{ transition: "stroke-dashoffset 1s ease-out", filter: `drop-shadow(0 0 6px ${color}80)` }}
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="26" fontWeight="bold" fontFamily="var(--font-sans)">
        {score}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#71717a" fontSize="9" fontFamily="var(--font-sans)">
        out of 100
      </text>
    </svg>
  );
}

export default function InsightsPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [insight, setInsight] = useState<BehavioralInsight | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [recentInsights, setRecentInsights] = useState<BehavioralInsight[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { checkAuth(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    setUserEmail(data.session.user.email || null);
    setUserId(data.session.user.id);
    await loadData();
    setDataLoaded(true);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
  }

  const loadData = useCallback(async () => {
    const [insightRes, healthRes, historyRes] = await Promise.all([
      supabase.from("behavioral_insights").select("*").order("date", { ascending: false }).limit(1).single(),
      supabase.from("health_data").select("*").order("date", { ascending: false }).limit(1).single(),
      supabase.from("behavioral_insights").select("date,risk_score").order("date", { ascending: false }).limit(14),
    ]);
    if (insightRes.data) setInsight(insightRes.data);
    if (healthRes.data) setHealth(healthRes.data);
    if (historyRes.data) setRecentInsights(historyRes.data.reverse());
  }, []);

  async function calculateRisk() {
    if (!userId) return;
    setCalculating(true);
    try {
      const res = await fetch("/api/insights/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (data.success) await loadData();
    } catch (e) {
      console.error("Calculate error:", e);
    }
    setCalculating(false);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) { router.push("/setup"); return; }

    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/backbone/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: "backbone",
        content: data.response ?? "Backbone is unavailable right now.",
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "backbone", content: "Backbone is unavailable right now. Try again in a moment." }]);
    }
    setIsLoading(false);
  }

  const spendChange = insight ? parseFloat(insight.spending_summary.change_percent) : 0;

  return (
    <AppShell userEmail={userEmail} onLogout={logout}>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">

        {/* ── Sidebar ── */}
        <div className="space-y-4">

          {/* Risk Score */}
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--text-dim)]">Behavioral Risk</h3>
              <button
                onClick={calculateRisk}
                disabled={calculating}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-dim)] hover:text-white disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${calculating ? "animate-spin" : ""}`} />
                {calculating ? "Calculating…" : "Recalculate"}
              </button>
            </div>
            {insight ? (
              <>
                <RiskGauge score={insight.risk_score} />
                <div className="text-center mt-1 mb-3">
                  <span className="text-sm font-semibold" style={{ color: getRiskColor(insight.risk_score) }}>
                    {getRiskLabel(insight.risk_score)}
                  </span>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{insight.date}</p>
                </div>
                <div className="space-y-1.5">
                  {insight.insights.slice(0, 4).map((ins, i) => (
                    <p key={i} className={`text-xs ${getInsightSeverityColor(ins)}`}>
                      {i === 0 ? ins : `· ${ins}`}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-4 text-center">
                <p className="text-sm text-[var(--text-muted)] mb-3">
                  {dataLoaded && !health
                    ? "Sync health data via iOS Shortcut first."
                    : "No risk score yet."}
                </p>
                {dataLoaded && health && (
                  <button
                    onClick={calculateRisk}
                    disabled={calculating}
                    className="px-4 py-2 bg-[var(--gold)] text-[#080808] rounded-lg text-sm font-bold disabled:opacity-50"
                  >
                    {calculating ? "Calculating…" : "Calculate Now"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Health Snapshot */}
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Health Snapshot</h3>
            {health ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm">
                    <Moon className="w-4 h-4" /> Sleep
                  </div>
                  <span className="text-white font-medium text-sm">
                    {health.sleep_hours != null ? `${health.sleep_hours.toFixed(1)}h` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm">
                    <Heart className="w-4 h-4" /> HRV
                  </div>
                  <span className="text-white font-medium text-sm">
                    {health.hrv_avg != null ? `${health.hrv_avg}ms` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm">
                    <Activity className="w-4 h-4" /> Activity
                  </div>
                  <span className="text-white font-medium text-sm">
                    {health.active_energy != null ? health.active_energy.toLocaleString() : "—"}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] pt-1">{health.date}</p>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No health data. Sync via iOS Shortcut.</p>
            )}
          </div>

          {/* Spending Comparison */}
          {insight && (
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Spending (7-day)</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">This week</span>
                  <span className="text-white font-medium">${parseFloat(insight.spending_summary.last_7_days).toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Last week</span>
                  <span className="text-[var(--text-dim)]">${parseFloat(insight.spending_summary.prev_7_days).toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-sm pt-1 border-t border-[var(--border)]">
                  <span className="text-[var(--text-muted)]">Change</span>
                  <span
                    className="font-semibold"
                    style={{ color: spendChange <= 0 ? "var(--safe)" : spendChange < 15 ? "var(--warn)" : "var(--danger)" }}
                  >
                    {spendChange > 0 ? "+" : ""}{spendChange.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 14-day risk trend */}
          {recentInsights.length > 1 && (
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-3">Risk history</h3>
              <div className="flex items-end gap-1 h-12">
                {recentInsights.map((r, i) => (
                  <div
                    key={i}
                    title={`${r.date}: ${r.risk_score}`}
                    className="flex-1 rounded-sm min-w-[6px] transition-all"
                    style={{
                      height: `${(r.risk_score / 100) * 100}%`,
                      backgroundColor: getRiskColor(r.risk_score),
                      opacity: 0.85,
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-[var(--text-muted)]">{recentInsights[0]?.date?.slice(5)}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{recentInsights[recentInsights.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Backbone Chat ── */}
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] flex flex-col min-h-[600px]">
          {/* Header */}
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="font-semibold text-white">Backbone</h2>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">Your behavioral finance AI · Powered by Claude</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-[var(--text-dim)] mb-4">
                  Ask Backbone anything about your spending patterns and behavioral state.
                </p>
                {SUGGESTED.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="block w-full text-left px-4 py-2.5 rounded-xl border border-[var(--glass-border)] bg-white/[0.03] text-sm text-[var(--text-dim)] hover:text-white hover:border-[var(--gold)]/40 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-white/90 text-[#080808] rounded-br-sm"
                      : "bg-white/[0.05] border border-[var(--glass-border)] text-[var(--text)] rounded-bl-sm"
                  }`}
                >
                  {msg.role === "backbone" ? (
                    <div className="prose prose-sm prose-invert max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mb-2 [&>ul]:pl-4 [&>ul>li]:mb-0.5">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white/[0.05] border border-[var(--glass-border)] px-4 py-3 rounded-2xl rounded-bl-sm">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 bg-[var(--text-dim)] rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-[var(--border)]">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage(input)}
                placeholder="Ask Backbone…"
                className="flex-1 px-4 py-2.5 border border-[var(--glass-border)] rounded-xl bg-white/[0.04] text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="px-3.5 py-2.5 bg-[var(--gold)] text-[#080808] rounded-xl disabled:opacity-40 transition-opacity hover:opacity-90"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
