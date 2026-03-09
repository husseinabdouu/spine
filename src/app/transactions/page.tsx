"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import AppShell from "@/components/AppShell";
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
import { CreditCard, Plus, X, Search, ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronUp, Check } from "lucide-react";
import {
  USER_CATEGORIES,
  INCOME_CATEGORIES,
  CATEGORY_COLORS,
  resolveCategory,
} from "@/lib/categorize";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

type Transaction = {
  id: string;
  merchant_name: string | null;
  description: string | null;
  amount_cents: number;
  posted_at: string;
  posted_at_timestamp: string | null;
  category: string | null;
  notes: string | null;
  is_necessary_expense: boolean | null;
};

type EditState = {
  amount: string;
  date: string;
  time: string;
  merchant: string;
  category: string;
  notes: string;
  is_necessary_expense: boolean;
};

type AddForm = {
  type: "expense" | "income";
  date: string;
  amount: string;
  merchant: string;
  category: string;
};

const INPUT_CLS =
  "w-full px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/50 text-sm";

const EDIT_INPUT_CLS =
  "w-full px-2.5 py-1.5 bg-[rgba(255,255,255,0.06)] border border-[var(--glass-border)] rounded-md text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/60 text-sm";

function toEditState(t: Transaction): EditState {
  const dateStr = String(t.posted_at).slice(0, 10);
  let timeStr = "00:00";
  if (t.posted_at_timestamp) {
    const d = new Date(t.posted_at_timestamp);
    if (!isNaN(d.getTime())) {
      timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
  return {
    amount: (Math.abs(t.amount_cents) / 100).toFixed(2),
    date: dateStr,
    time: timeStr,
    merchant: t.merchant_name || t.description || "",
    category: resolveCategory(t.category),
    notes: t.notes || "",
    is_necessary_expense: t.is_necessary_expense ?? false,
  };
}

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"7" | "30" | "90" | "all">("90");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"spending" | "income">("spending");
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>({
    type: "expense",
    date: format(new Date(), "yyyy-MM-dd"),
    amount: "",
    merchant: "",
    category: "Food & Drink",
  });

  // Expand/edit state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push("/setup"); return; }
    setUserEmail(data.session.user.email || null);
    setUserId(data.session.user.id);
    loadTransactions();
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
  }

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("transactions")
      .select("id, merchant_name, description, amount_cents, posted_at, posted_at_timestamp, category, notes, is_necessary_expense")
      .order("posted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);

    if (dateRange !== "all") {
      const dateStr = subDays(new Date(), parseInt(dateRange)).toISOString().split("T")[0];
      query = query.gte("posted_at", dateStr);
    }

    const { data, error } = await query;
    if (!error && data) setTransactions(data as Transaction[]);
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  function toggleExpand(t: Transaction) {
    if (expandedId === t.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(t.id);
    if (!editStates[t.id]) {
      setEditStates(prev => ({ ...prev, [t.id]: toEditState(t) }));
    }
  }

  function updateEdit(id: string, patch: Partial<EditState>) {
    setEditStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function showSaved(id: string) {
    setSavedIds(prev => new Set(prev).add(id));
    if (savedTimers.current[id]) clearTimeout(savedTimers.current[id]);
    savedTimers.current[id] = setTimeout(() => {
      setSavedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 2000);
  }

  async function saveField(id: string, overrideEdit?: Partial<EditState>) {
    const base = editStates[id];
    if (!base) return;
    const edit = overrideEdit ? { ...base, ...overrideEdit } : base;

    const amountVal = parseFloat(edit.amount);
    if (isNaN(amountVal) || amountVal <= 0) return;

    const newCents = Math.round(amountVal * 100);

    // Build posted_at_timestamp from date + time
    let newTimestamp: string | null = null;
    if (edit.date) {
      const [h, m] = edit.time.split(":").map(Number);
      const d = new Date(`${edit.date}T${String(h || 0).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00`);
      if (!isNaN(d.getTime())) newTimestamp = d.toISOString();
    }

    const updates: Record<string, unknown> = {
      amount_cents: newCents,
      posted_at: edit.date,
      posted_at_timestamp: newTimestamp,
      merchant_name: edit.merchant || null,
      description: edit.merchant || null,
      category: edit.category,
      notes: edit.notes || null,
      is_necessary_expense: edit.is_necessary_expense,
    };

    const { error } = await supabase
      .from("transactions")
      .update(updates)
      .eq("id", id);

    if (!error) {
      setTransactions(prev =>
        prev.map(t =>
          t.id === id
            ? {
                ...t,
                amount_cents: newCents,
                posted_at: edit.date,
                posted_at_timestamp: newTimestamp,
                merchant_name: edit.merchant || null,
                description: edit.merchant || null,
                category: edit.category,
                notes: edit.notes || null,
                is_necessary_expense: edit.is_necessary_expense,
              }
            : t
        )
      );
      showSaved(id);
    } else {
      console.error("Save failed:", error);
    }
  }

  const updateCategory = useCallback(async (id: string, newCat: string) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, category: newCat } : t));
    const { error } = await supabase.from("transactions").update({ category: newCat }).eq("id", id);
    if (error) {
      console.error("Category update failed:", error);
      loadTransactions();
    }
  }, [loadTransactions]);

  async function saveManualTransaction() {
    if (!userId || !addForm.amount || !addForm.merchant) return;
    setSaving(true);
    const cents = Math.round(parseFloat(addForm.amount) * 100);
    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      plaid_transaction_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amount_cents: addForm.type === "income" ? -cents : cents,
      posted_at: addForm.date,
      merchant_name: addForm.merchant,
      description: addForm.merchant,
      category: addForm.category,
    });
    if (!error) {
      setShowAddModal(false);
      setAddForm({ type: "expense", date: format(new Date(), "yyyy-MM-dd"), amount: "", merchant: "", category: "Food & Drink" });
      loadTransactions();
    } else {
      console.error("Save failed:", error);
    }
    setSaving(false);
  }

  const spending = useMemo(() => transactions.filter(t => t.amount_cents > 0), [transactions]);
  const income = useMemo(() => transactions.filter(t => t.amount_cents <= 0), [transactions]);

  const filteredSpending = useMemo(() => {
    let list = spending;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.merchant_name || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        resolveCategory(t.category).toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") {
      list = list.filter(t => resolveCategory(t.category) === categoryFilter);
    }
    return list;
  }, [spending, search, categoryFilter]);

  const filteredIncome = useMemo(() => {
    if (!search) return income;
    const q = search.toLowerCase();
    return income.filter(t =>
      (t.merchant_name || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q)
    );
  }, [income, search]);

  const categoryData = useMemo(() => {
    const byCat: Record<string, number> = {};
    filteredSpending.forEach(t => {
      const cat = resolveCategory(t.category);
      byCat[cat] = (byCat[cat] || 0) + t.amount_cents / 100;
    });
    return Object.entries(byCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredSpending]);

  const chartData = useMemo(() => {
    if (dateRange === "all") {
      const byMonth: Record<string, number> = {};
      filteredSpending.forEach(t => {
        const month = String(t.posted_at).slice(0, 7);
        byMonth[month] = (byMonth[month] || 0) + t.amount_cents / 100;
      });
      return Object.keys(byMonth)
        .sort()
        .map(m => ({ label: format(parseLocalDate(m + "-01"), "MMM yy"), spend: byMonth[m] }));
    }
    const byDay: Record<string, number> = {};
    filteredSpending.forEach(t => {
      const day = String(t.posted_at).slice(0, 10);
      byDay[day] = (byDay[day] || 0) + t.amount_cents / 100;
    });
    const days = parseInt(dateRange);
    return Array.from({ length: days }, (_, i) => {
      const d = subDays(new Date(), days - 1 - i);
      const ds = format(d, "yyyy-MM-dd");
      return { label: format(d, "MMM d"), spend: byDay[ds] || 0 };
    });
  }, [filteredSpending, dateRange]);

  const totalSpend = useMemo(() => filteredSpending.reduce((s, t) => s + t.amount_cents, 0) / 100, [filteredSpending]);
  const totalIncome = useMemo(() => income.reduce((s, t) => s + Math.abs(t.amount_cents), 0) / 100, [income]);

  function getName(t: Transaction) { return t.merchant_name || t.description || "Unknown"; }

  function renderExpandedEdit(t: Transaction) {
    const edit = editStates[t.id];
    if (!edit) return null;
    const isSaved = savedIds.has(t.id);

    return (
      <div className="px-4 pb-4 bg-[rgba(255,255,255,0.025)] border-t border-[var(--glass-border)]">
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Amount */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Amount ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={edit.amount}
              onChange={e => updateEdit(t.id, { amount: e.target.value })}
              onBlur={() => saveField(t.id)}
              className={EDIT_INPUT_CLS}
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Date</label>
            <input
              type="date"
              value={edit.date}
              onChange={e => updateEdit(t.id, { date: e.target.value })}
              onBlur={() => saveField(t.id)}
              className={EDIT_INPUT_CLS}
            />
          </div>

          {/* Time */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Time</label>
            <input
              type="time"
              value={edit.time}
              onChange={e => updateEdit(t.id, { time: e.target.value })}
              onBlur={() => saveField(t.id)}
              className={EDIT_INPUT_CLS}
            />
          </div>

          {/* Merchant */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Merchant</label>
            <input
              type="text"
              value={edit.merchant}
              onChange={e => updateEdit(t.id, { merchant: e.target.value })}
              onBlur={() => saveField(t.id)}
              className={EDIT_INPUT_CLS}
              placeholder="Merchant name"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Category</label>
            <select
              value={edit.category}
              onChange={e => {
                const newCat = e.target.value;
                updateEdit(t.id, { category: newCat });
                saveField(t.id, { category: newCat });
              }}
              className={EDIT_INPUT_CLS}
            >
              {USER_CATEGORIES.map(c => (
                <option key={c} value={c} style={{ backgroundColor: "var(--select-bg)", color: "var(--select-color)" }}>{c}</option>
              ))}
            </select>
          </div>

          {/* Notes — full width */}
          <div className="sm:col-span-2">
            <label className="text-xs text-[var(--text-muted)] mb-1 block">Notes</label>
            <textarea
              value={edit.notes}
              onChange={e => updateEdit(t.id, { notes: e.target.value })}
              onBlur={() => saveField(t.id)}
              rows={2}
              placeholder="Add a note..."
              className={`${EDIT_INPUT_CLS} resize-none`}
            />
          </div>

          {/* Necessary expense + saved indicator */}
          <div className="sm:col-span-2 flex items-center justify-between">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={edit.is_necessary_expense}
                  onChange={e => {
                    const checked = e.target.checked;
                    updateEdit(t.id, { is_necessary_expense: checked });
                    saveField(t.id, { is_necessary_expense: checked });
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 rounded-full border border-[var(--glass-border)] bg-[rgba(255,255,255,0.06)] peer-checked:bg-[var(--gold)] transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--text-muted)] peer-checked:translate-x-4 peer-checked:bg-[#080808] transition-all" />
              </div>
              <span className="text-xs text-[var(--text-dim)]">Necessary expense</span>
            </label>

            <div className={`flex items-center gap-1.5 text-xs font-medium transition-all duration-300 ${isSaved ? "opacity-100 text-[var(--safe)]" : "opacity-0"}`}>
              <Check className="w-3.5 h-3.5" />
              Saved
            </div>
          </div>
        </div>

        {/* Collapse */}
        <button
          onClick={() => setExpandedId(null)}
          className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Collapse
        </button>
      </div>
    );
  }

  return (
    <AppShell title="Transactions" userEmail={userEmail} onLogout={logout}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 -mt-2">
        <p className="text-[var(--text-dim)] text-sm">
          {spending.length.toLocaleString()} expenses · {income.length.toLocaleString()} income
          {dateRange !== "all" && <span className="text-[var(--text-muted)]"> (last {dateRange} days)</span>}
        </p>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--gold)] hover:opacity-90 text-[#080808] rounded-lg text-sm font-bold transition-opacity"
        >
          <Plus className="w-4 h-4" /> Add Transaction
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <ArrowUpRight className="w-4 h-4 text-[var(--danger)]" /> Total spent
          </div>
          <div className="text-2xl font-bold text-[var(--text)]">
            ${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {dateRange === "all" ? "All time" : `Last ${dateRange} days`} · {filteredSpending.length} transactions
          </div>
        </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <ArrowDownLeft className="w-4 h-4 text-[var(--safe)]" /> Total income
          </div>
          <div className="text-2xl font-bold text-[var(--safe)]">
            ${totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{income.length} entries</div>
        </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <TrendingUp className="w-4 h-4" /> Top category
          </div>
          <div className="text-lg font-semibold text-[var(--text)] truncate">{categoryData[0]?.name || "—"}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {categoryData[0] ? `$${categoryData[0].value.toFixed(0)} spent` : "No data"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-1 w-fit">
        {(["spending", "income"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === tab ? "bg-[var(--gold)] text-[#080808]" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
          >
            {tab} ({tab === "spending" ? spending.length : income.length})
          </button>
        ))}
      </div>

      {activeTab === "spending" ? (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">Spending by category</h3>
              {categoryData.length > 0 ? (
                <div className="h-52">
                  <Doughnut
                    data={{
                      labels: categoryData.map(d => d.name),
                      datasets: [{ data: categoryData.map(d => d.value), backgroundColor: categoryData.map(d => CATEGORY_COLORS[d.name] || "#71717a"), borderWidth: 0, hoverOffset: 4 }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false, cutout: "60%",
                      plugins: {
                        legend: { position: "right", labels: { color: "#878787", font: { size: 11 }, boxWidth: 10, padding: 8 } },
                        tooltip: { callbacks: { label: ctx => ` $${(ctx.parsed ?? 0).toFixed(2)}` } },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">No spending data</div>
              )}
            </div>
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">Daily spending</h3>
              {chartData.some(d => d.spend > 0) ? (
                <div className="h-52">
                  <Bar
                    data={{
                      labels: chartData.map(d => d.label),
                      datasets: [{ data: chartData.map(d => d.spend), backgroundColor: "#C9A84C", borderRadius: 4, borderSkipped: false }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `$${(ctx.parsed.y ?? 0).toFixed(2)}` } } },
                      scales: {
                        x: { grid: { display: false }, ticks: { color: "#71717a", font: { size: 10 }, maxTicksLimit: 12 }, border: { display: false } },
                        y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { color: "#71717a", font: { size: 10 }, callback: v => `$${v}` }, border: { display: false } },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">No spending data</div>
              )}
            </div>
          </div>

          {/* Filters + list */}
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl overflow-hidden backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input type="text" placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/50 text-sm" />
              </div>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] focus:outline-none text-sm">
                <option value="all">All categories</option>
                {USER_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={dateRange} onChange={e => setDateRange(e.target.value as "7" | "30" | "90" | "all")} className="px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] focus:outline-none text-sm">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="all">All time</option>
              </select>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {loading ? (
                <div className="p-10 text-center text-[var(--text-muted)] animate-pulse">Loading...</div>
              ) : filteredSpending.length === 0 ? (
                <div className="p-10 text-center text-[var(--text-muted)]">No transactions found.</div>
              ) : filteredSpending.map(t => {
                const cat = resolveCategory(t.category);
                const color = CATEGORY_COLORS[cat] || "#71717a";
                const isExpanded = expandedId === t.id;
                return (
                  <div key={t.id} className={`transition-colors ${isExpanded ? "bg-[rgba(255,255,255,0.03)]" : ""}`}>
                    {/* Row */}
                    <div
                      className="flex items-center justify-between px-4 py-3 hover:bg-[var(--glass-hover-subtle)] transition-colors cursor-pointer"
                      onClick={() => toggleExpand(t)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}18` }}>
                          <CreditCard className="w-4 h-4" style={{ color }} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--text)] text-sm truncate">{getName(t)}</div>
                          <div className="text-xs text-[var(--text-dim)] mt-0.5">{format(parseLocalDate(String(t.posted_at)), "MMM d, yyyy")}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 ml-4">
                        {/* Inline category pill — stop propagation so click doesn't toggle expand */}
                        <select
                          value={cat}
                          onChange={e => { e.stopPropagation(); updateCategory(t.id, e.target.value); }}
                          onClick={e => e.stopPropagation()}
                          className="text-xs px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/50 transition-colors"
                          style={{ backgroundColor: `${color}15`, borderColor: `${color}50`, color }}
                        >
                          {USER_CATEGORIES.map(c => (
                            <option key={c} value={c} style={{ backgroundColor: "var(--select-bg)", color: "var(--select-color)" }}>{c}</option>
                          ))}
                        </select>
                        <div className="text-sm font-semibold text-[var(--text-dim)] w-20 text-right tabular-nums">
                          -${(t.amount_cents / 100).toFixed(2)}
                        </div>
                        <ChevronUp
                          className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${isExpanded ? "rotate-0" : "rotate-180"}`}
                        />
                      </div>
                    </div>

                    {/* Expanded edit panel */}
                    {isExpanded && renderExpandedEdit(t)}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Income tab */
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl overflow-hidden backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          {filteredIncome.length === 0 ? (
            <div className="p-12 text-center text-[var(--text-muted)]">No income entries found.</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filteredIncome.map(t => (
                <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-[var(--glass-hover-subtle)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[var(--safe-dim)] flex items-center justify-center shrink-0">
                      <ArrowDownLeft className="w-4 h-4 text-[var(--safe)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text)] text-sm truncate">{getName(t)}</div>
                      <div className="text-xs text-[var(--text-dim)] mt-0.5">
                        {t.category || "Income"} · {format(parseLocalDate(String(t.posted_at)), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-[var(--safe)] shrink-0 tabular-nums">
                    +${Math.abs(t.amount_cents / 100).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-[var(--modal-overlay)] backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowAddModal(false)}
        >
          <div className="bg-[var(--modal-bg)] border border-[var(--glass-border)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">Add Transaction</h2>
              <button onClick={() => setShowAddModal(false)} className="text-[var(--text-dim)] hover:text-[var(--text-strong)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Expense / Income toggle */}
            <div className="flex gap-2 mb-5 p-1 bg-[var(--glass-bg)] rounded-xl border border-[var(--glass-border)]">
              <button
                onClick={() => setAddForm(f => ({ ...f, type: "expense", category: "Food & Drink" }))}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${addForm.type === "expense" ? "bg-[var(--danger)] text-white" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
              >
                Expense
              </button>
              <button
                onClick={() => setAddForm(f => ({ ...f, type: "income", category: "Other Income" }))}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${addForm.type === "income" ? "bg-[var(--safe)] text-[#080808] font-semibold" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
              >
                Income
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-dim)] mb-1.5 block">Date</label>
                  <input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-dim)] mb-1.5 block">Amount ($)</label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">{addForm.type === "income" ? "Source" : "Merchant"}</label>
                <input type="text" placeholder={addForm.type === "income" ? "e.g. Salary, Allowance…" : "e.g. Uber Eats, Amazon…"} value={addForm.merchant} onChange={e => setAddForm(f => ({ ...f, merchant: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">Category</label>
                <select value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} className={INPUT_CLS}>
                  {(addForm.type === "expense" ? USER_CATEGORIES : INCOME_CATEGORIES).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-2.5 border border-[var(--glass-border)] rounded-xl text-[var(--text-dim)] hover:text-[var(--text-strong)] text-sm transition-colors">
                Cancel
              </button>
              <button
                onClick={saveManualTransaction}
                disabled={saving || !addForm.amount || !addForm.merchant}
                className="flex-1 py-2.5 bg-[var(--gold)] hover:opacity-90 disabled:opacity-50 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
