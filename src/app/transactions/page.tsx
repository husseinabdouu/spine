"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Category = {
  id: string;
  name: string;
};

type Transaction = {
  id: string;
  description: string;
  amount_cents: number;
  posted_at: string;
  category_id: string | null;
  categories: { name: string } | null;
};

export default function TransactionsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPostedAt, setEditPostedAt] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const MAX_ABS_AMOUNT = 1000000000; // $1,000,000,000

  async function loadCategories() {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name")
      .order("name");

    if (!error && data) setCategories(data);
  }

  async function loadTransactions() {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
        id,
        description,
        amount_cents,
        posted_at,
        category_id,
        categories(name)
      `,
      )
      .order("posted_at", { ascending: false })
      .order("id", { ascending: false });

    if (!error && data) {
      const typed = data as unknown as Transaction[];
      setTransactions(typed);

      // If currently editing a transaction that no longer exists, exit edit mode
      if (editingId && !typed.some((t) => t.id === editingId)) {
        cancelEdit();
      }
    }
  }

  // ✅ DELETE (must NOT be nested inside addTransaction)
  async function deleteTransaction(id: string) {
    setMessage(null);

    const { error } = await supabase.from("transactions").delete().eq("id", id);

    if (error) {
      setMessage("Error deleting: " + error.message);
      return;
    }

    setMessage("🗑️ Transaction deleted");
    loadTransactions();
  }

  // ✅ UPDATE CATEGORY (must NOT be nested inside addTransaction)
  async function updateTransactionCategory(id: string, newCategoryId: string) {
    setMessage(null);

    const { error } = await supabase
      .from("transactions")
      .update({ category_id: newCategoryId || null })
      .eq("id", id);

    if (error) {
      setMessage("Error updating category: " + error.message);
      return;
    }

    setMessage("✅ Category updated");
    loadTransactions();
  }
  function startEdit(t: Transaction) {
    setEditingId(t.id);
    setEditDescription(t.description ?? "");
    setEditAmount(((t.amount_cents ?? 0) / 100).toFixed(2));
    setEditPostedAt(t.posted_at ? String(t.posted_at).slice(0, 10) : "");
    setMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDescription("");
    setEditAmount("");
    setEditPostedAt("");
    setMessage(null);
  }

  async function saveEdit(id: string) {
    setMessage(null);

    if (savingId === id) return;
    setSavingId(id);

    if (!editDescription || !editAmount || !editPostedAt) {
      setMessage("All fields required");
      setSavingId(null);
      return;
    }

    const parsed = Number(editAmount);

    if (!Number.isFinite(parsed)) {
      setMessage("Amount must be a valid number");
      setSavingId(null);
      return;
    }

    if (parsed === 0) {
      setMessage("Amount cannot be 0");
      setSavingId(null);
      return;
    }

    if (Math.abs(parsed) > MAX_ABS_AMOUNT) {
      setMessage(
        `Amount seems too large (max $${MAX_ABS_AMOUNT.toLocaleString()})`,
      );
      setSavingId(null);
      return;
    }

    const amountCents = Math.round(parsed * 100);

    const { error } = await supabase
      .from("transactions")
      .update({
        description: editDescription,
        amount_cents: amountCents,
        posted_at: editPostedAt,
      })
      .eq("id", id);

    if (error) {
      setMessage("Error updating: " + error.message);
      setSavingId(null);
      return;
    }

    setMessage("✅ Transaction updated");
    setSavingId(null);
    cancelEdit();
    loadTransactions();
  }

  async function addTransaction() {
    setMessage(null);

    if (isAdding) return;
    setIsAdding(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
      setMessage("Not logged in");
      setIsAdding(false);
      return;
    }

    if (!description || !amount || !postedAt || !categoryId) {
      setMessage("All fields required");
      setIsAdding(false);
      return;
    }

    const parsed = Number(amount);

    if (!Number.isFinite(parsed)) {
      setMessage("Amount must be a valid number");
      setIsAdding(false);
      return;
    }

    if (parsed === 0) {
      setMessage("Amount cannot be 0");
      setIsAdding(false);
      return;
    }

    if (Math.abs(parsed) > MAX_ABS_AMOUNT) {
      setMessage(
        `Amount seems too large (max $${MAX_ABS_AMOUNT.toLocaleString()})`,
      );
      setIsAdding(false);
      return;
    }

    const amountCents = Math.round(parsed * 100);

    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      description,
      amount_cents: amountCents,
      posted_at: postedAt,
      category_id: categoryId,
      source: "manual",
    });

    if (error) {
      setMessage("Error: " + error.message);
      setIsAdding(false);
      return;
    }

    setDescription("");
    setAmount("");
    setPostedAt("");
    setCategoryId("");
    setMessage("✅ Transaction added");
    setIsAdding(false);

    loadTransactions();
  }

  useEffect(() => {
    loadCategories();
    loadTransactions();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 700 }}>
      <h1>Transactions</h1>

      <nav style={{ marginTop: 20, marginBottom: 30 }}>
        <a href="/dashboard" style={{ marginRight: 20 }}>
          Dashboard
        </a>
        <a href="/transactions" style={{ marginRight: 20 }}>
          Transactions
        </a>
        <a href="/insights" style={{ marginRight: 20 }}>
          Insights
        </a>
        <a href="/settings">Settings</a>
      </nav>

      <div style={{ marginTop: 20 }}>
        <h3>Add Transaction</h3>

        <input
          placeholder="Description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setMessage(null);
          }}
          style={{ display: "block", marginBottom: 8, width: "100%" }}
        />

        <input
          placeholder="Amount (e.g. 12.50)"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setMessage(null);
          }}
          style={{ display: "block", marginBottom: 8, width: "100%" }}
        />

        <input
          type="date"
          value={postedAt}
          onChange={(e) => {
            setPostedAt(e.target.value);
            setMessage(null);
          }}
          style={{ display: "block", marginBottom: 8 }}
        />

        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setMessage(null);
          }}
          style={{ display: "block", marginBottom: 8 }}
        >
          <option value="">Select category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button onClick={addTransaction} disabled={isAdding}>
          {isAdding ? "Adding..." : "Add"}
        </button>

        {message && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <p style={{ margin: 0 }}>{message}</p>
            <button
              onClick={() => setMessage(null)}
              aria-label="Dismiss message"
            >
              x
            </button>
          </div>
        )}
      </div>

      <hr style={{ margin: "30px 0" }} />

      <h3>Transaction List</h3>

      {transactions.length === 0 ? (
        <p>No transactions yet.</p>
      ) : (
        <ul>
          {transactions.map((t) => (
            <li key={t.id} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {editingId === t.id ? (
                  <>
                    <input
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description"
                    />

                    <input
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      placeholder="Amount"
                      inputMode="decimal"
                    />

                    <input
                      type="date"
                      value={editPostedAt}
                      onChange={(e) => setEditPostedAt(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <span>{t.description}</span>
                    <span>— ${(t.amount_cents / 100).toFixed(2)}</span>
                    <span>— {t.categories?.name ?? "Uncategorized"}</span>
                    <span>— {String(t.posted_at ?? "").slice(0, 10)}</span>
                  </>
                )}
              </div>

              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <select
                  value={t.category_id ?? ""}
                  onChange={(e) =>
                    updateTransactionCategory(t.id, e.target.value)
                  }
                  disabled={editingId === t.id}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {editingId === t.id ? (
                  <>
                    <button
                      onClick={() => saveEdit(t.id)}
                      disabled={savingId === t.id}
                    >
                      {savingId === t.id ? "Saving..." : "Save"}
                    </button>

                    <button onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <button
                    onClick={() => startEdit(t)}
                    disabled={isAdding || savingId !== null}
                  >
                    Edit
                  </button>
                )}

                <button
                  onClick={() => deleteTransaction(t.id)}
                  disabled={editingId === t.id}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
