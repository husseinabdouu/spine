"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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

const CARD = "rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]";
const SHORTCUT_URL = "https://spine-one.vercel.app/api/health/submit";

export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [latestHealth, setLatestHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    const user = data.session.user;
    setUserEmail(user.email || null);
    setUserId(user.id);
    setMemberSince(user.created_at);
    await Promise.all([loadPlaidItems(), loadLatestHealth(user.id)]);
    setLoading(false);
  }

  const loadPlaidItems = useCallback(async () => {
    const { data } = await supabase
      .from("plaid_items")
      .select("id, institution_name, created_at")
      .order("created_at", { ascending: false });
    if (data) setPlaidItems(data);
  }, []);

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
        toast("Bank disconnected. Transaction history is preserved.", "info");
        loadPlaidItems();
      } else {
        toast(data.error || "Failed to disconnect", "error");
      }
    } catch {
      toast("Failed to disconnect bank", "error");
    }
    setDisconnecting(null);
  }

  function handlePlaidSuccess() {
    toast("Bank connected! Fetching transaction history…", "success");
    loadPlaidItems();
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
