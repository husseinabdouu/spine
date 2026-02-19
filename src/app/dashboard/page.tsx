"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import PlaidLink from "@/components/PlaidLink";

type Transaction = {
  amount_cents: number;
  posted_at: string;
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
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [weeklySpend, setWeeklySpend] = useState(0);
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [syncing, setSyncing] = useState(false);
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
    loadDashboardData();
    loadPlaidItems();
    loadHealthData();
    loadBehavioralInsights();
  }

  async function loadDashboardData() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("transactions")
      .select("amount_cents, posted_at")
      .gte("posted_at", dateStr)
      .order("posted_at", { ascending: false });

    if (!error && data) {
      setTransactions(data);

      const total = data.reduce((sum, t) => sum + (t.amount_cents || 0), 0);
      setWeeklySpend(total / 100);
    }

    setLoading(false);
  }

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
        alert("Not logged in");
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
        alert("Behavioral risk calculated successfully!");
        loadBehavioralInsights();
      } else {
        alert("Error: " + data.error);
      }
    } catch (error) {
      console.error("Calculate error:", error);
      alert("Failed to calculate behavioral risk");
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
        alert("Not logged in");
        setSyncing(false);
        return;
      }

      const response = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`Synced! Added ${data.transactions_added} new transactions.`);
        loadDashboardData();
      } else {
        alert("Error syncing transactions: " + data.error);
      }
    } catch (error) {
      console.error("Sync error:", error);
      alert("Failed to sync transactions");
    }

    setSyncing(false);
  }

  function handlePlaidSuccess() {
    alert("Bank connected successfully!");
    loadPlaidItems();
    syncTransactions();
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

  if (loading) {
    return <div style={{ padding: 24 }}>Loading dashboard...</div>;
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>Spine Dashboard</h1>
        <div>
          <span style={{ marginRight: 20 }}>{userEmail}</span>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

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

      {/* Bank Connection Section */}
      <div
        style={{
          padding: 20,
          background: "#f0f9ff",
          borderRadius: 8,
          marginBottom: 30,
        }}
      >
        <h3 style={{ margin: 0, marginBottom: 15, color: "#1a1a1a" }}>
          Bank Connections
        </h3>

        {plaidItems.length === 0 ? (
          <div>
            <p style={{ marginBottom: 15, color: "#666" }}>
              No banks connected yet. Connect your bank to auto-sync
              transactions.
            </p>
            <PlaidLink onSuccess={handlePlaidSuccess} />
          </div>
        ) : (
          <div>
            {plaidItems.map((item) => (
              <div key={item.id} style={{ marginBottom: 10 }}>
                <span style={{ color: "#1a1a1a" }}>
                  🏦 {item.institution_name}
                </span>
              </div>
            ))}
            <div style={{ marginTop: 15, display: "flex", gap: 10 }}>
              <button
                onClick={syncTransactions}
                disabled={syncing}
                style={{
                  padding: "12px 24px",
                  fontSize: 16,
                  cursor: syncing ? "not-allowed" : "pointer",
                  backgroundColor: "#10b981",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                }}
              >
                {syncing ? "Syncing..." : "Sync Transactions"}
              </button>
              <PlaidLink onSuccess={handlePlaidSuccess} />
            </div>
          </div>
        )}
      </div>

      {/* Behavioral Insights Section */}
      {behavioralInsight ? (
        <div
          style={{
            padding: 30,
            background: "#fef3c7",
            borderRadius: 8,
            marginBottom: 30,
            border: `3px solid ${getRiskColor(behavioralInsight.risk_score)}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 15,
            }}
          >
            <h2 style={{ margin: 0, color: "#1a1a1a" }}>
              Behavioral Risk Score
            </h2>
            <button
              onClick={calculateBehavioralRisk}
              disabled={calculating}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                cursor: calculating ? "not-allowed" : "pointer",
                backgroundColor: "#6366f1",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
              }}
            >
              {calculating ? "Calculating..." : "Recalculate"}
            </button>
          </div>

          <div
            style={{
              fontSize: 64,
              fontWeight: "bold",
              color: getRiskColor(behavioralInsight.risk_score),
              marginBottom: 10,
            }}
          >
            {behavioralInsight.risk_score}
            <span style={{ fontSize: 24, marginLeft: 10 }}>
              {getRiskLevel(behavioralInsight.risk_score)}
            </span>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 style={{ margin: 0, marginBottom: 10, color: "#1a1a1a" }}>
              Insights:
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#1a1a1a" }}>
              {behavioralInsight.insights.map((insight, idx) => (
                <li key={idx} style={{ marginBottom: 8 }}>
                  {insight}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, fontSize: 12, color: "#666" }}>
            <strong>7-Day Averages:</strong> Sleep:{" "}
            {behavioralInsight.health_summary.avg_sleep}hrs | HRV:{" "}
            {behavioralInsight.health_summary.avg_hrv}ms | Activity:{" "}
            {behavioralInsight.health_summary.avg_activity}
          </div>

          <div style={{ marginTop: 5, fontSize: 12, color: "#666" }}>
            <strong>Spending Trend:</strong> This week: $
            {behavioralInsight.spending_summary.last_7_days} | Last week: $
            {behavioralInsight.spending_summary.prev_7_days} | Change:{" "}
            {behavioralInsight.spending_summary.change_percent}%
          </div>

          <p style={{ margin: 0, marginTop: 15, fontSize: 12, color: "#666" }}>
            Last calculated:{" "}
            {new Date(behavioralInsight.date).toLocaleDateString()}
          </p>
        </div>
      ) : (
        <div
          style={{
            padding: 30,
            background: "#f3f4f6",
            borderRadius: 8,
            marginBottom: 30,
            textAlign: "center",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: 10, color: "#1a1a1a" }}>
            Behavioral Risk Score
          </h2>
          <p style={{ color: "#666", marginBottom: 20 }}>
            Calculate your behavioral risk score based on health and spending
            patterns.
          </p>
          <button
            onClick={calculateBehavioralRisk}
            disabled={calculating}
            style={{
              padding: "12px 24px",
              fontSize: 16,
              cursor: calculating ? "not-allowed" : "pointer",
              backgroundColor: "#6366f1",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
            }}
          >
            {calculating ? "Calculating..." : "Calculate Behavioral Risk"}
          </button>
          <p style={{ fontSize: 12, color: "#999", marginTop: 10 }}>
            Requires at least 3 days of health data and transaction history
          </p>
        </div>
      )}

      {/* Health Metrics Section */}
      <div
        style={{
          padding: 30,
          background: "#f5f5f5",
          borderRadius: 8,
          marginBottom: 30,
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 10, color: "#1a1a1a" }}>
          Today's Health
        </h2>

        {healthData ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              {healthData.sleep_hours !== null && (
                <div>
                  <div style={{ fontSize: 14, color: "#666" }}>Sleep</div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: "bold",
                      color: "#1a1a1a",
                    }}
                  >
                    {healthData.sleep_hours.toFixed(1)} hrs
                  </div>
                </div>
              )}
              {healthData.hrv_avg !== null && (
                <div>
                  <div style={{ fontSize: 14, color: "#666" }}>HRV</div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: "bold",
                      color: "#1a1a1a",
                    }}
                  >
                    {healthData.hrv_avg} ms
                  </div>
                </div>
              )}
              {healthData.active_energy !== null && (
                <div>
                  <div style={{ fontSize: 14, color: "#666" }}>Activity</div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: "bold",
                      color: "#1a1a1a",
                    }}
                  >
                    {healthData.active_energy.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
            <p
              style={{ margin: 0, marginTop: 15, fontSize: 12, color: "#666" }}
            >
              Last updated: {new Date(healthData.date).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p style={{ margin: 0, marginTop: 10, color: "#666" }}>
            No health data yet. Run your iOS Shortcut to sync health data.
          </p>
        )}
      </div>

      <div
        style={{
          padding: 20,
          background: "#fafafa",
          borderRadius: 8,
        }}
      >
        <h3 style={{ color: "#1a1a1a" }}>This Week's Spending</h3>
        <div style={{ fontSize: 32, fontWeight: "bold", color: "#1a1a1a" }}>
          ${weeklySpend.toFixed(2)}
        </div>
        <p style={{ color: "#666", fontSize: 14 }}>
          {transactions.length} transactions in last 7 days
        </p>
      </div>

      <div
        style={{
          marginTop: 30,
          padding: 20,
          background: "#fff3cd",
          borderRadius: 8,
        }}
      >
        <h3 style={{ color: "#856404" }}>⚠️ Setup Progress:</h3>
        <ol style={{ color: "#856404" }}>
          <li>
            {plaidItems.length > 0
              ? "✅ Bank connected!"
              : "Connect your bank account"}
          </li>
          <li>
            {healthData
              ? "✅ Health data synced!"
              : "Run iOS Shortcut to sync health data"}
          </li>
          <li>
            {behavioralInsight
              ? "✅ Behavioral insights active!"
              : "Calculate behavioral risk score"}
          </li>
          <li>Use app for 14 days to refine predictions</li>
        </ol>
      </div>
    </main>
  );
}
