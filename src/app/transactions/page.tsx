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
import {
  CreditCard,
  Plus,
  X,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  TrendingUp,
  ChevronUp,
  Check,
  Upload,
  FileText,
} from "lucide-react";
import {
  NON_BEHAVIORAL_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_TREE,
  PARENT_CATEGORIES,
  resolveCategory,
  getParentCategory,
  type SubCategory,
} from "@/lib/categorize";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
);

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
  time: string;
  amount: string;
  merchant: string;
  category: string;
  notes: string;
};

// CSV import types
type CsvRow = Record<string, string>;
type CsvField =
  | "date"
  | "amount"
  | "merchant"
  | "category"
  | "type"
  | "notes"
  | "(ignore)";
const CSV_FIELDS: CsvField[] = [
  "date",
  "amount",
  "merchant",
  "category",
  "type",
  "notes",
  "(ignore)",
];

type CsvImportStep = "idle" | "map" | "preview" | "importing" | "done";

const INPUT_CLS =
  "w-full px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/50 text-sm";

/** Returns a display color for a parent category using its first subcategory's color. */
function parentCategoryColor(parent: string): string {
  const firstSub = CATEGORY_TREE[parent as keyof typeof CATEGORY_TREE]?.[0];
  return (firstSub ? CATEGORY_COLORS[firstSub] : null) ?? "#71717a";
}

/** Returns grouped <optgroup>/<option> elements for user-facing category picker. */
function renderCategoryOptions() {
  return PARENT_CATEGORIES.map((parent) => (
    <optgroup key={parent} label={parent}>
      {CATEGORY_TREE[parent].map((sub) => (
        <option key={sub} value={sub} style={{ backgroundColor: "var(--select-bg)", color: "var(--select-color)" }}>
          {sub}
        </option>
      ))}
    </optgroup>
  ));
}

/** Returns grouped options INCLUDING system categories for the expanded-edit panel. */
function renderCategoryOptionsWithSystem() {
  return (
    <>
      {renderCategoryOptions()}
      <optgroup label="System">
        {(NON_BEHAVIORAL_CATEGORIES as readonly string[]).map((c) => (
          <option key={c} value={c} style={{ backgroundColor: "var(--select-bg)", color: "var(--select-color)" }}>
            {c}
          </option>
        ))}
      </optgroup>
    </>
  );
}

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

/** Naive CSV parser — handles quoted fields with commas inside. */
function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split("\n");
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitLine(lines[0]);
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const vals = splitLine(l);
      const obj: CsvRow = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] ?? "";
      });
      return obj;
    });
  return { headers, rows };
}

/** Guess the best Spine field for a CSV column header (handles Origin AI column names). */
function guessMapping(header: string): CsvField {
  const h = header.toLowerCase().trim();
  if (/^type$/.test(h)) return "type";
  if (/date|posted|time/.test(h)) return "date";
  if (/amount|price|cost|total|sum/.test(h)) return "amount";
  if (/merchant|vendor|payee|name|description|desc/.test(h)) return "merchant";
  if (/cat(egory)?/.test(h)) return "category";
  if (/note|memo|comment/.test(h)) return "notes";
  return "(ignore)";
}

/** Base dedup key component: date + amount-cents + merchant (lowercased). */
function csvDedupeBase(
  date: string,
  amountCents: number,
  merchant: string,
): string {
  return `csv_${date}_${amountCents}_${merchant.toLowerCase().replace(/\s+/g, "_")}`;
}

/** Try to parse an amount string (strips $, commas, spaces). */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Origin AI Expense-type category → Spine subcategory
const ORIGIN_EXPENSE_CAT: Record<string, SubCategory> = {
  "drinks & dining":  "Dining Out",
  "food & drink":     "Dining Out",
  "food delivery":    "Food Delivery",
  groceries:          "Groceries",
  "auto & transport": "Taxis & Rideshare",
  transportation:     "Taxis & Rideshare",
  travel:             "Travel",
  shopping:           "Wants",
  clothing:           "Clothing",
  entertainment:      "Events & Concerts",
  nightlife:          "Nightlife",
  health:             "Medical",
  healthcare:         "Medical",
  "health & wellness": "Medical",
  "personal care":    "Personal Care",
  education:          "Needs",
  utilities:          "Needs",
  gifts:              "Gifts",
  donations:          "Gifts",
  subscriptions:      "Subscriptions",
  "gym & fitness":    "Gym & Fitness",
  fitness:            "Gym & Fitness",
  investments:        "Investments",
  other:              "Other",
};

function containsCI(text: string, keyword: string): boolean {
  return text.toUpperCase().includes(keyword.toUpperCase());
}

/**
 * Categorize a row from an Origin AI CSV export into a Spine subcategory.
 * Rules applied in priority order (first match wins).
 *
 * Zelle Debit / Venmo outgoing / Cash App outgoing → "needs_classification"
 * sentinel so the UI can prompt the user to pick a subcategory manually.
 *
 * @param typeCol    Value of the "Type" column (e.g. "Transfer", "Expense", "Income")
 * @param desc       Description / merchant name
 * @param catCol     Value of the "Category" column from Origin AI
 * @param rawAmount  Raw amount from CSV (Origin: negative = money out, positive = money in)
 */
function originCategorize(
  typeCol: string,
  desc: string,
  catCol: string,
  rawAmount: number,
): string {
  const type = typeCol.trim().toLowerCase();

  // 1. Internal transfer keywords
  const TRANSFER_KW = [
    "ONLINE TRANSFER TO",
    "ONLINE TRANSFER FROM",
    "Transfer to Checking",
    "Transfer from Checking",
    "Transfer to Savings",
    "Transfer from Savings",
    "Transfer to Money Market",
    "Transfer from Money Market",
    "Transfer To Checking",
    "Transfer From Checking",
    "Transfer To Money Market",
    "Transfer From Money Market",
  ];
  if (TRANSFER_KW.some((k) => containsCI(desc, k))) return "Internal Transfer";

  // 2. ATM
  if (["ATM WITHDRAWAL", "CITIBANK ATM", "ATM CASH"].some((k) => containsCI(desc, k)))
    return "ATM Withdrawal";

  // 3. Zelle Credit → Income (money coming in from another person)
  if (containsCI(desc, "ZELLE CREDIT")) return "Income";

  // 4. Zelle Debit / Venmo outgoing / Cash App outgoing → needs_classification
  //    These are person-to-person payments that could be food, rent, events, etc.
  //    Flag them so the user is prompted to pick a subcategory.
  if (
    containsCI(desc, "ZELLE DEBIT") ||
    (rawAmount < 0 && containsCI(desc, "VENMO") && !containsCI(desc, "VENMO CREDIT")) ||
    (rawAmount < 0 && containsCI(desc, "CASH APP") && !containsCI(desc, "CASH APP CREDIT"))
  )
    return "needs_classification";

  // 5. Interest Payment OR Type = Income → Income
  if (containsCI(desc, "Interest Payment") || type === "income")
    return "Income";

  // 6. Robinhood with Transfer type going out → Investments
  if (type === "transfer" && rawAmount < 0 && containsCI(desc, "ROBINHOOD"))
    return "Investments";

  // 7. Type = Expense → map Origin category to Spine subcategory
  if (type === "expense") {
    const mapped = ORIGIN_EXPENSE_CAT[catCol.trim().toLowerCase()];
    return mapped ?? "Other";
  }

  // 8. Type = Transfer with positive amount in CSV (money coming in) → Income
  if (type === "transfer" && rawAmount > 0) return "Income";

  // 9. Everything else
  return "Other";
}

/**
 * Amount sign convention for Origin AI CSVs:
 *   Origin uses negative = money OUT, positive = money IN.
 *   Spine stores expenses as positive, income as negative.
 *   Simple flip: storedCents = Math.round(-rawAmount * 100)
 */
function originAmountCents(rawAmount: number): number {
  return Math.round(-rawAmount * 100);
}

/** Try to parse a date string into YYYY-MM-DD. */
function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mdy)
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // Try native Date parse as last resort
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  return null;
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
    time: "",
    amount: "",
    merchant: "",
    category: "Dining Out",
    notes: "",
  });

  // Expand/edit state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // CSV import state
  const [csvStep, setCsvStep] = useState<CsvImportStep>("idle");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, CsvField>>({});
  const [csvImportCount, setCsvImportCount] = useState(0);
  const [csvImportError, setCsvImportError] = useState<string | null>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

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
      .select(
        "id, merchant_name, description, amount_cents, posted_at, posted_at_timestamp, category, notes, is_necessary_expense",
      )
      .order("posted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);

    if (dateRange !== "all") {
      const dateStr = subDays(new Date(), parseInt(dateRange))
        .toISOString()
        .split("T")[0];
      query = query.gte("posted_at", dateStr);
    }

    const { data, error } = await query;
    if (!error && data) setTransactions(data as Transaction[]);
    setLoading(false);
  }, [dateRange]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  function toggleExpand(t: Transaction) {
    if (expandedId === t.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(t.id);
    if (!editStates[t.id]) {
      setEditStates((prev) => ({ ...prev, [t.id]: toEditState(t) }));
    }
  }

  function updateEdit(id: string, patch: Partial<EditState>) {
    setEditStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function showSaved(id: string) {
    setSavedIds((prev) => new Set(prev).add(id));
    if (savedTimers.current[id]) clearTimeout(savedTimers.current[id]);
    savedTimers.current[id] = setTimeout(() => {
      setSavedIds((prev) => {
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

    let newTimestamp: string | null = null;
    if (edit.date) {
      const [h, m] = edit.time.split(":").map(Number);
      const d = new Date(
        `${edit.date}T${String(h || 0).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00`,
      );
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
      setTransactions((prev) =>
        prev.map((t) =>
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
            : t,
        ),
      );
      showSaved(id);
    } else {
      console.error("Save failed:", error);
    }
  }

  const updateCategory = useCallback(
    async (id: string, newCat: string) => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, category: newCat } : t)),
      );
      const { error } = await supabase
        .from("transactions")
        .update({ category: newCat })
        .eq("id", id);
      if (error) {
        console.error("Category update failed:", error);
        loadTransactions();
      }
    },
    [loadTransactions],
  );

  async function saveManualTransaction() {
    if (!userId || !addForm.amount || !addForm.merchant) return;
    setSaving(true);
    const cents = Math.round(parseFloat(addForm.amount) * 100);

    // Build posted_at_timestamp from date + optional time
    let postedAtTimestamp: string | null = null;
    if (addForm.date) {
      const timeStr = addForm.time || "00:00";
      const [h, m] = timeStr.split(":").map(Number);
      const d = new Date(
        `${addForm.date}T${String(h || 0).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00`,
      );
      if (!isNaN(d.getTime())) postedAtTimestamp = d.toISOString();
    }

    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      plaid_transaction_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amount_cents: addForm.type === "income" ? -cents : cents,
      posted_at: addForm.date,
      posted_at_timestamp: postedAtTimestamp,
      merchant_name: addForm.merchant,
      description: addForm.merchant,
      category: addForm.category,
      notes: addForm.notes || null,
    });
    if (!error) {
      setShowAddModal(false);
      setAddForm({
        type: "expense",
        date: format(new Date(), "yyyy-MM-dd"),
        time: "",
        amount: "",
        merchant: "",
      category: "Dining Out",
      notes: "",
    });
    loadTransactions();
    } else {
      console.error("Save failed:", error);
    }
    setSaving(false);
  }

  // ── CSV Import ────────────────────────────────────────────────────────────

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCsv(text);
      if (!headers.length || !rows.length) {
        alert(
          "Could not parse this CSV. Make sure it has a header row and data rows.",
        );
        return;
      }
      const initialMapping: Record<string, CsvField> = {};
      headers.forEach((h) => {
        initialMapping[h] = guessMapping(h);
      });
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(initialMapping);
      setCsvStep("map");
      setCsvImportError(null);
    };
    reader.readAsText(file);
    // reset so the same file can be re-selected
    e.target.value = "";
  }

  function closeCsvModal() {
    setCsvStep("idle");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    setCsvImportError(null);
  }

  /** Build preview rows from the current mapping. Returns null if required fields are missing. */
  function buildPreviewRows():
    | {
        date: string;
        amountCents: number;
        merchant: string;
        category: string;
        notes: string;
      }[]
    | null {
    const dateCol = Object.entries(csvMapping).find(
      ([, v]) => v === "date",
    )?.[0];
    const amountCol = Object.entries(csvMapping).find(
      ([, v]) => v === "amount",
    )?.[0];
    const merchantCol = Object.entries(csvMapping).find(
      ([, v]) => v === "merchant",
    )?.[0];

    if (!dateCol || !amountCol) return null;

    const typeCol = Object.entries(csvMapping).find(
      ([, v]) => v === "type",
    )?.[0];
    const categoryCol = Object.entries(csvMapping).find(
      ([, v]) => v === "category",
    )?.[0];
    const notesCol = Object.entries(csvMapping).find(
      ([, v]) => v === "notes",
    )?.[0];

    const result: {
      date: string;
      amountCents: number;
      merchant: string;
      category: string;
      notes: string;
    }[] = [];

    for (const row of csvRows) {
      const rawDate = row[dateCol] ?? "";
      const rawAmount = row[amountCol] ?? "";
      const merchant = merchantCol ? (row[merchantCol] ?? "") : "";
      const typeRaw = typeCol ? (row[typeCol] ?? "") : "";
      const catRaw = categoryCol ? (row[categoryCol] ?? "") : "";
      const notes = notesCol ? (row[notesCol] ?? "") : "";

      const date = parseDate(rawDate);
      const amount = parseAmount(rawAmount);

      if (!date || amount === null) continue;

      const description = merchant.trim();

      // Categorize using Type column + description keywords + Origin category mapping
      // Pass rawAmount so rule 6 (Robinhood/Venmo/Cash App outgoing) and rule 8 (Transfer+) work
      const category = originCategorize(typeRaw, description, catRaw, amount);

      // Sign: Origin AI uses negative = out, positive = in. Flip for Spine convention.
      const amountCents = originAmountCents(amount);

      result.push({
        date,
        amountCents,
        merchant: description,
        category,
        notes: notes.trim(),
      });
    }

    return result;
  }

  async function runCsvImport() {
    if (!userId) return;
    const rows = buildPreviewRows();
    if (!rows || rows.length === 0) {
      setCsvImportError("No valid rows to import. Check your column mapping.");
      return;
    }

    setCsvStep("importing");
    setCsvImportError(null);

    // Debug: log first 5 parsed rows to verify signs before inserting
    console.log(
      "[CSV Import] First 5 parsed rows:",
      rows.slice(0, 5).map((r) => ({
        date: r.date,
        merchant: r.merchant,
        category: r.category,
        rawAmountCents: r.amountCents,
        dollars: (r.amountCents / 100).toFixed(2),
        sign: r.amountCents > 0 ? "EXPENSE (+)" : "INCOME (−)",
      })),
    );

    // Build per-row dedup keys with a sequence suffix so repeated transactions
    // (e.g. two MTA swipes on the same day for the same amount) get distinct keys:
    // csv_2026-03-01_275_mta_1, csv_2026-03-01_275_mta_2, etc.
    // Re-importing the same CSV produces the same keys, so it stays idempotent.
    // Dedup base uses absolute amount so sign differences don't create phantom uniqueness.
    // Re-importing the same CSV produces identical keys → idempotent.
    const occurrences: Record<string, number> = {};
    const toUpsert = rows.map((r) => {
      const base = csvDedupeBase(r.date, Math.abs(r.amountCents), r.merchant);
      occurrences[base] = (occurrences[base] ?? 0) + 1;
      const key = `${base}_${occurrences[base]}`;
      return {
        user_id: userId,
        plaid_transaction_id: key,
        amount_cents: r.amountCents, // sign preserved: negative = income
        posted_at: r.date,
        merchant_name: r.merchant || null,
        description: r.merchant || "CSV import",
        category: r.category || "Other",
        notes: r.notes || null,
      };
    });

    // Batch in chunks of 200 to stay within Supabase limits
    const CHUNK = 200;
    let totalImported = 0;
    for (let i = 0; i < toUpsert.length; i += CHUNK) {
      const chunk = toUpsert.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("transactions")
        .upsert(chunk, {
          onConflict: "plaid_transaction_id",
          ignoreDuplicates: true,
        });
      if (error) {
        setCsvImportError(`Import failed: ${error.message}`);
        setCsvStep("preview");
        return;
      }
      totalImported += chunk.length;
    }

    setCsvImportCount(totalImported);
    setCsvStep("done");
    loadTransactions();
  }

  const previewRows = useMemo(() => {
    if (csvStep !== "preview" && csvStep !== "map") return null;
    return buildPreviewRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvStep, csvMapping, csvRows]);

  // ── Data derivations ──────────────────────────────────────────────────────

  // Source of truth is always category, never amount_cents sign.
  //   spending  = all non-Income transactions (Transfers + ATM show greyed-out in this tab)
  //   income    = only category = "Income"
  //   billable  = spending minus Internal Transfer / ATM Withdrawal (used for totals/charts)
  const spending = useMemo(
    () => transactions.filter((t) => resolveCategory(t.category) !== "Income"),
    [transactions],
  );
  const income = useMemo(
    () => transactions.filter((t) => resolveCategory(t.category) === "Income"),
    [transactions],
  );

  const filteredSpending = useMemo(() => {
    let list = spending;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.merchant_name || "").toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          resolveCategory(t.category).toLowerCase().includes(q),
      );
    }
    if (categoryFilter !== "all") {
      list = list.filter((t) => resolveCategory(t.category) === categoryFilter);
    }
    return list;
  }, [spending, search, categoryFilter]);

  const filteredIncome = useMemo(() => {
    if (!search) return income;
    const q = search.toLowerCase();
    return income.filter(
      (t) =>
        (t.merchant_name || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q),
    );
  }, [income, search]);

  // billableSpending = spending rows that count toward behavioral totals/charts
  // (excludes Internal Transfer, ATM Withdrawal — Income is already excluded from spending)
  const billableSpending = useMemo(
    () =>
      filteredSpending.filter((t) => {
        const cat = resolveCategory(t.category);
        return cat !== "Internal Transfer" && cat !== "ATM Withdrawal";
      }),
    [filteredSpending],
  );

  const categoryData = useMemo(() => {
    const byParent: Record<string, number> = {};
    billableSpending.forEach((t) => {
      const sub = resolveCategory(t.category);
      const parent = getParentCategory(sub) ?? "Other";
      byParent[parent] = (byParent[parent] || 0) + Math.abs(t.amount_cents) / 100;
    });
    return Object.entries(byParent)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [billableSpending]);

  const chartData = useMemo(() => {
    // Always aggregate by calendar month for cleaner bar chart
    const byMonth: Record<string, number> = {};
    billableSpending.forEach((t) => {
      const month = String(t.posted_at).slice(0, 7); // "YYYY-MM"
      byMonth[month] = (byMonth[month] || 0) + Math.abs(t.amount_cents) / 100;
    });
    return Object.keys(byMonth)
      .sort()
      .map((m) => ({
        label: format(parseLocalDate(m + "-01"), "MMM"),
        spend: byMonth[m],
      }));
  }, [billableSpending]);

  const totalSpend = useMemo(
    () =>
      billableSpending.reduce((s, t) => s + Math.abs(t.amount_cents), 0) / 100,
    [billableSpending],
  );
  const totalIncome = useMemo(
    () => income.reduce((s, t) => s + Math.abs(t.amount_cents), 0) / 100,
    [income],
  );

  function getName(t: Transaction) {
    return t.merchant_name || t.description || "Unknown";
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderExpandedEdit(t: Transaction) {
    const edit = editStates[t.id];
    if (!edit) return null;
    const isSaved = savedIds.has(t.id);

    return (
      <div className="px-4 pb-4 bg-[rgba(255,255,255,0.025)] border-t border-[var(--glass-border)]">
        <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Amount ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={edit.amount}
              onChange={(e) => updateEdit(t.id, { amount: e.target.value })}
              className={EDIT_INPUT_CLS}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Date
            </label>
            <input
              type="date"
              value={edit.date}
              onChange={(e) => updateEdit(t.id, { date: e.target.value })}
              className={EDIT_INPUT_CLS}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Time
            </label>
            <input
              type="time"
              value={edit.time}
              onChange={(e) => updateEdit(t.id, { time: e.target.value })}
              className={EDIT_INPUT_CLS}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Merchant
            </label>
            <input
              type="text"
              value={edit.merchant}
              onChange={(e) => updateEdit(t.id, { merchant: e.target.value })}
              className={EDIT_INPUT_CLS}
              placeholder="Merchant name"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Category
            </label>
            <select
              value={edit.category}
              onChange={(e) => updateEdit(t.id, { category: e.target.value })}
              className={EDIT_INPUT_CLS}
            >
              {renderCategoryOptionsWithSystem()}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-[var(--text-muted)] mb-1 block">
              Notes
            </label>
            <textarea
              value={edit.notes}
              onChange={(e) => updateEdit(t.id, { notes: e.target.value })}
              rows={2}
              placeholder="Add a note..."
              className={`${EDIT_INPUT_CLS} resize-none`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={edit.is_necessary_expense}
                  onChange={(e) =>
                    updateEdit(t.id, { is_necessary_expense: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-9 h-5 rounded-full border border-[var(--glass-border)] bg-[rgba(255,255,255,0.06)] peer-checked:bg-[var(--gold)] transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--text-muted)] peer-checked:translate-x-4 peer-checked:bg-[#080808] transition-all" />
              </div>
              <span className="text-xs text-[var(--text-dim)]">
                Necessary expense
              </span>
            </label>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => saveField(t.id)}
            className="flex-1 py-2 bg-[var(--gold)] hover:opacity-90 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
          >
            {isSaved ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            ) : (
              "Save changes"
            )}
          </button>
          <button
            onClick={() => setExpandedId(null)}
            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--glass-border)] rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Collapse
          </button>
        </div>
      </div>
    );
  }

  function renderCsvModal() {
    if (csvStep === "idle") return null;

    return (
      <div
        className="fixed inset-0 bg-[var(--modal-overlay)] backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) =>
          e.target === e.currentTarget &&
          csvStep !== "importing" &&
          closeCsvModal()
        }
      >
        <div className="bg-[var(--modal-bg)] border border-[var(--glass-border)] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--glass-border)]">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-[var(--gold)]" />
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">
                {csvStep === "map" && "Map CSV columns"}
                {csvStep === "preview" && "Preview import"}
                {csvStep === "importing" && "Importing…"}
                {csvStep === "done" && "Import complete"}
              </h2>
            </div>
            {csvStep !== "importing" && (
              <button
                onClick={closeCsvModal}
                className="text-[var(--text-dim)] hover:text-[var(--text-strong)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 p-6">
            {/* Step: map */}
            {csvStep === "map" && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--text-dim)]">
                  Match each column in your CSV to a Spine field. At minimum,{" "}
                  <span className="text-[var(--text)]">date</span> and{" "}
                  <span className="text-[var(--text)]">amount</span> are
                  required.
                </p>
                <div className="space-y-2">
                  {csvHeaders.map((h) => (
                    <div key={h} className="flex items-center gap-4">
                      <div
                        className="w-48 shrink-0 text-sm text-[var(--text)] font-mono truncate"
                        title={h}
                      >
                        {h}
                      </div>
                      <select
                        value={csvMapping[h] ?? "(ignore)"}
                        onChange={(e) =>
                          setCsvMapping((prev) => ({
                            ...prev,
                            [h]: e.target.value as CsvField,
                          }))
                        }
                        className="flex-1 px-2.5 py-1.5 bg-[rgba(255,255,255,0.06)] border border-[var(--glass-border)] rounded-md text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/60 text-sm"
                      >
                        {CSV_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <div
                        className="w-40 shrink-0 text-xs text-[var(--text-muted)] truncate font-mono"
                        title={csvRows[0]?.[h]}
                      >
                        {csvRows[0]?.[h] ?? ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step: preview */}
            {csvStep === "preview" && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--text-dim)]">
                  First 5 rows that will be imported ({previewRows?.length ?? 0}{" "}
                  total valid rows detected). Re-importing the same CSV is safe
                  — each row gets a unique key (date + amount + merchant +
                  sequence number), so duplicates are skipped but repeat
                  transactions like two MTA swipes on the same day are both
                  imported.
                </p>
                {previewRows && previewRows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--glass-border)] text-[var(--text-muted)]">
                          <th className="text-left py-2 pr-3 font-medium">
                            Date
                          </th>
                          <th className="text-right py-2 pr-3 font-medium">
                            Amount
                          </th>
                          <th className="text-left py-2 pr-3 font-medium">
                            Merchant
                          </th>
                          <th className="text-left py-2 pr-3 font-medium">
                            Category
                          </th>
                          <th className="text-left py-2 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--glass-border)]">
                        {previewRows.slice(0, 5).map((r, i) => (
                          <tr key={i} className="text-[var(--text-dim)]">
                            <td className="py-2 pr-3">{r.date}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              ${(r.amountCents / 100).toFixed(2)}
                            </td>
                            <td className="py-2 pr-3 truncate max-w-[120px]">
                              {r.merchant || "—"}
                            </td>
                            <td className="py-2 pr-3">{r.category}</td>
                            <td className="py-2 truncate max-w-[100px]">
                              {r.notes || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {previewRows.length > 5 && (
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        …and {previewRows.length - 5} more rows
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--danger)]">
                    No valid rows found. Go back and check your column mapping —
                    date and amount are required.
                  </p>
                )}
                {csvImportError && (
                  <p className="text-sm text-[var(--danger)] bg-[var(--danger-dim)] border border-[var(--danger)]/20 rounded-lg px-3 py-2">
                    {csvImportError}
                  </p>
                )}
              </div>
            )}

            {/* Step: importing */}
            {csvStep === "importing" && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-[var(--text-dim)]">
                  Importing transactions…
                </p>
              </div>
            )}

            {/* Step: done */}
            {csvStep === "done" && (
              <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--safe-dim)] flex items-center justify-center">
                  <Check className="w-6 h-6 text-[var(--safe)]" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--text-strong)]">
                    {csvImportCount} transactions imported
                  </p>
                  <p className="text-sm text-[var(--text-dim)] mt-1">
                    Duplicates were automatically skipped.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-6 pt-4 border-t border-[var(--glass-border)] flex gap-3 justify-end">
            {csvStep === "map" && (
              <>
                <button
                  onClick={closeCsvModal}
                  className="px-4 py-2 border border-[var(--glass-border)] rounded-xl text-[var(--text-dim)] hover:text-[var(--text-strong)] text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const hasDate = Object.values(csvMapping).includes("date");
                    const hasAmount =
                      Object.values(csvMapping).includes("amount");
                    if (!hasDate || !hasAmount) {
                      alert(
                        "You must map at least a date and an amount column.",
                      );
                      return;
                    }
                    setCsvStep("preview");
                  }}
                  className="px-5 py-2 bg-[var(--gold)] hover:opacity-90 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
                >
                  Preview →
                </button>
              </>
            )}
            {csvStep === "preview" && (
              <>
                <button
                  onClick={() => setCsvStep("map")}
                  className="px-4 py-2 border border-[var(--glass-border)] rounded-xl text-[var(--text-dim)] hover:text-[var(--text-strong)] text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => void runCsvImport()}
                  disabled={!previewRows || previewRows.length === 0}
                  className="px-5 py-2 bg-[var(--gold)] hover:opacity-90 disabled:opacity-50 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
                >
                  Import {previewRows?.length ?? 0} rows
                </button>
              </>
            )}
            {csvStep === "done" && (
              <button
                onClick={closeCsvModal}
                className="px-5 py-2 bg-[var(--gold)] hover:opacity-90 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <AppShell title="Transactions" userEmail={userEmail} onLogout={() => void logout()}>
      {/* Hidden CSV file input */}
      <input
        ref={csvFileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleCsvFile}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6 -mt-2">
        <p className="text-[var(--text-dim)] text-sm">
          {transactions.length.toLocaleString()} total ·{" "}
          {billableSpending.length.toLocaleString()} expenses ·{" "}
          {income.length.toLocaleString()} income ·{" "}
          {(
            transactions.length -
            billableSpending.length -
            income.length
          ).toLocaleString()}{" "}
          excluded (transfers/ATM)
          {dateRange !== "all" && (
            <span className="text-[var(--text-muted)]">
              {" "}
              (last {dateRange} days)
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => csvFileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] hover:bg-[var(--glass-hover-subtle)] border border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] rounded-lg text-sm font-medium transition-all"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--gold)] hover:opacity-90 text-[#080808] rounded-lg text-sm font-bold transition-opacity"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <ArrowUpRight className="w-4 h-4 text-[var(--danger)]" /> Total
            spent
          </div>
          <div className="text-2xl font-bold text-[var(--text)]">
            ${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {dateRange === "all" ? "All time" : `Last ${dateRange} days`} ·{" "}
            {billableSpending.length} transactions
          </div>
        </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <ArrowDownLeft className="w-4 h-4 text-[var(--safe)]" /> Total
            income
          </div>
          <div className="text-2xl font-bold text-[var(--safe)]">
            ${totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {income.length.toLocaleString()} entries
          </div>
        </div>
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-sm mb-1">
            <TrendingUp className="w-4 h-4" /> Top category
          </div>
          <div className="text-lg font-semibold text-[var(--text)] truncate">
            {categoryData[0]?.name || "—"}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {categoryData[0]
              ? `$${categoryData[0].value.toFixed(0)} spent`
              : "No data"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-1 w-fit">
        {(["spending", "income"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === tab ? "bg-[var(--gold)] text-[#080808]" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
          >
            {tab} (
            {tab === "spending" ? billableSpending.length : income.length})
          </button>
        ))}
      </div>

      {activeTab === "spending" ? (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">
                Spending by category
              </h3>
              {categoryData.length > 0 ? (
                <div className="h-52">
                  <Doughnut
                    data={{
                      labels: categoryData.map((d) => d.name),
                      datasets: [
                        {
                          data: categoryData.map((d) => d.value),
                          backgroundColor: categoryData.map(
                            (d) => parentCategoryColor(d.name),
                          ),
                          borderWidth: 0,
                          hoverOffset: 4,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: "60%",
                      plugins: {
                        legend: {
                          position: "right",
                          labels: {
                            color: "#878787",
                            font: { size: 11 },
                            boxWidth: 10,
                            padding: 8,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => ` $${(ctx.parsed ?? 0).toFixed(2)}`,
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">
                  No spending data
                </div>
              )}
            </div>
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-5 backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <h3 className="text-sm font-medium text-[var(--text-dim)] mb-4">
                Monthly spending
              </h3>
              {chartData.some((d) => d.spend > 0) ? (
                <div className="h-52">
                  <Bar
                    data={{
                      labels: chartData.map((d) => d.label),
                      datasets: [
                        {
                          data: chartData.map((d) => d.spend),
                          backgroundColor: "#C9A84C",
                          borderRadius: 4,
                          borderSkipped: false,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (ctx) =>
                              `$${(ctx.parsed.y ?? 0).toFixed(2)}`,
                          },
                        },
                      },
                      scales: {
                        x: {
                          grid: { display: false },
                          ticks: {
                            color: "#71717a",
                            font: { size: 10 },
                            maxTicksLimit: 12,
                          },
                          border: { display: false },
                        },
                        y: {
                          grid: { color: "rgba(255,255,255,0.04)" },
                          ticks: {
                            color: "#71717a",
                            font: { size: 10 },
                            callback: (v) => `$${v}`,
                          },
                          border: { display: false },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-[var(--text-muted)] text-sm">
                  No spending data
                </div>
              )}
            </div>
          </div>

          {/* Filters + list */}
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl overflow-hidden backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search transactions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/50 text-sm"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] focus:outline-none text-sm"
              >
                <option value="all">All categories</option>
                {PARENT_CATEGORIES.map((parent) => (
                  <optgroup key={parent} label={parent}>
                    {CATEGORY_TREE[parent].map((sub) => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="── System ──">
                  {(NON_BEHAVIORAL_CATEGORIES as readonly string[]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
              </select>
              <select
                value={dateRange}
                onChange={(e) =>
                  setDateRange(e.target.value as "7" | "30" | "90" | "all")
                }
                className="px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg text-[var(--text)] focus:outline-none text-sm"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="all">All time</option>
              </select>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {loading ? (
                <div className="p-10 text-center text-[var(--text-muted)] animate-pulse">
                  Loading...
                </div>
              ) : filteredSpending.length === 0 ? (
                <div className="p-10 text-center text-[var(--text-muted)]">
                  No transactions found.
                </div>
              ) : (
                filteredSpending.map((t) => {
                  const rawCat = t.category ?? "";
                  const needsClassification = rawCat === "needs_classification";
                  const cat = needsClassification ? ("Other" as const) : resolveCategory(t.category);
                  const color = needsClassification ? "#ef4444" : (CATEGORY_COLORS[cat] || "#71717a");
                  const isExpanded = expandedId === t.id;
                  const isTransfer = cat === "Internal Transfer";
                  const isAtm = cat === "ATM Withdrawal";
                  const isExcluded = isTransfer || isAtm;
                  return (
                    <div
                      key={t.id}
                      className={`transition-colors ${isExpanded ? "bg-[rgba(255,255,255,0.03)]" : ""} ${isExcluded ? "opacity-50" : ""}`}
                    >
                      <div
                        className="flex items-center justify-between px-4 py-3 hover:bg-[var(--glass-hover-subtle)] transition-colors cursor-pointer"
                        onClick={() => toggleExpand(t)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${color}18` }}
                          >
                            {isTransfer ? (
                              <ArrowLeftRight
                                className="w-4 h-4"
                                style={{ color }}
                              />
                            ) : (
                              <CreditCard
                                className="w-4 h-4"
                                style={{ color }}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`font-medium text-sm truncate ${isExcluded ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
                            >
                              {getName(t)}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-xs text-[var(--text-muted)]">
                                {format(parseLocalDate(String(t.posted_at)), "MMM d, yyyy")}
                              </span>
                              {!isExcluded && !needsClassification && (() => {
                                const parent = getParentCategory(cat);
                                return parent && parent !== cat ? (
                                  <>
                                    <span className="text-[var(--text-muted)] text-xs opacity-40">·</span>
                                    <span className="text-[10px] text-[var(--text-muted)] opacity-70">{parent}</span>
                                  </>
                                ) : null;
                              })()}
                              {needsClassification && (
                                <span className="text-[10px] text-red-400 font-medium">Needs classification</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 ml-4">
                          <select
                            value={needsClassification ? "" : cat}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateCategory(t.id, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2.5 py-1 rounded-full border cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/50 transition-colors"
                            style={{
                              backgroundColor: needsClassification ? "rgba(239,68,68,0.15)" : `${color}15`,
                              borderColor: needsClassification ? "rgba(239,68,68,0.5)" : `${color}50`,
                              color,
                            }}
                          >
                            {needsClassification && (
                              <option value="" disabled>Classify…</option>
                            )}
                            {renderCategoryOptionsWithSystem()}
                          </select>
                          <div
                            className={`text-sm font-semibold w-20 text-right tabular-nums ${isExcluded ? "text-[var(--text-muted)]" : "text-[var(--text-dim)]"}`}
                          >
                            ${(Math.abs(t.amount_cents) / 100).toFixed(2)}
                          </div>
                          <ChevronUp
                            className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${isExpanded ? "rotate-0" : "rotate-180"}`}
                          />
                        </div>
                      </div>
                      {isExpanded && renderExpandedEdit(t)}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl overflow-hidden backdrop-blur-[28px] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          {filteredIncome.length === 0 ? (
            <div className="p-12 text-center text-[var(--text-muted)]">
              No income entries found.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filteredIncome.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[var(--glass-hover-subtle)] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[var(--safe-dim)] flex items-center justify-center shrink-0">
                      <ArrowDownLeft className="w-4 h-4 text-[var(--safe)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text)] text-sm truncate">
                        {getName(t)}
                      </div>
                      <div className="text-xs text-[var(--text-dim)] mt-0.5">
                        {t.category || "Income"} ·{" "}
                        {format(
                          parseLocalDate(String(t.posted_at)),
                          "MMM d, yyyy",
                        )}
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
          onClick={(e) =>
            e.target === e.currentTarget && setShowAddModal(false)
          }
        >
          <div className="bg-[var(--modal-bg)] border border-[var(--glass-border)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">
                Add Transaction
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-[var(--text-dim)] hover:text-[var(--text-strong)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2 mb-5 p-1 bg-[var(--glass-bg)] rounded-xl border border-[var(--glass-border)]">
              <button
                onClick={() =>
                  setAddForm((f) => ({
                    ...f,
                    type: "expense",
                    category: "Dining Out",
                    time: f.time,
                    notes: f.notes,
                  }))
                }
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${addForm.type === "expense" ? "bg-[var(--danger)] text-white" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
              >
                Expense
              </button>
              <button
                onClick={() =>
                  setAddForm((f) => ({
                    ...f,
                    type: "income",
                    category: "Other Income",
                    time: f.time,
                    notes: f.notes,
                  }))
                }
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${addForm.type === "income" ? "bg-[var(--safe)] text-[#080808] font-semibold" : "text-[var(--text-dim)] hover:text-[var(--text-strong)]"}`}
              >
                Income
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                    Date
                  </label>
                  <input
                    type="date"
                    value={addForm.date}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, date: e.target.value }))
                    }
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                    Time{" "}
                    <span className="text-[var(--text-muted)]">(optional)</span>
                  </label>
                  <input
                    type="time"
                    value={addForm.time}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, time: e.target.value }))
                    }
                    className={INPUT_CLS}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                  Amount ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={addForm.amount}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                  {addForm.type === "income" ? "Source" : "Merchant"}
                </label>
                <input
                  type="text"
                  placeholder={
                    addForm.type === "income"
                      ? "e.g. Salary, Allowance…"
                      : "e.g. Uber Eats, Amazon…"
                  }
                  value={addForm.merchant}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, merchant: e.target.value }))
                  }
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                  Category
                </label>
                <select
                  value={addForm.category}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className={INPUT_CLS}
                >
                  {addForm.type === "expense" ? (
                    renderCategoryOptions()
                  ) : (
                    <option value="Income">Income</option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] mb-1.5 block">
                  Notes{" "}
                  <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <textarea
                  value={addForm.notes}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={2}
                  placeholder="Add a note…"
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 border border-[var(--glass-border)] rounded-xl text-[var(--text-dim)] hover:text-[var(--text-strong)] text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveManualTransaction()}
                disabled={saving || !addForm.amount || !addForm.merchant}
                className="flex-1 py-2.5 bg-[var(--gold)] hover:opacity-90 disabled:opacity-50 text-[#080808] rounded-xl text-sm font-bold transition-opacity"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {renderCsvModal()}
    </AppShell>
  );
}
