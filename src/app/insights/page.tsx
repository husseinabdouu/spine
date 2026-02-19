"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InsightsPage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function askQuestion() {
    if (!question.trim()) return;

    setLoading(true);
    setAnswer(
      "AI insights coming soon! This will use Claude API to analyze your spending patterns.",
    );
    setLoading(false);
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
      <h1>AI Insights</h1>

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

      <div style={{ marginTop: 30 }}>
        <h3>Ask About Your Spending Patterns</h3>

        <input
          type="text"
          placeholder="e.g., Why do I overspend on weekends?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 16,
            marginBottom: 10,
          }}
        />

        <button
          onClick={askQuestion}
          disabled={loading}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Thinking..." : "Ask"}
        </button>

        {answer && (
          <div
            style={{
              marginTop: 20,
              padding: 20,
              background: "#f5f5f5",
              borderRadius: 8,
            }}
          >
            <p>{answer}</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 40 }}>
        <h3>Suggested Questions:</h3>
        <ul>
          <li>What's my biggest behavioral trigger?</li>
          <li>How can I reduce my behavioral tax?</li>
          <li>When am I most likely to overspend?</li>
        </ul>
      </div>
    </main>
  );
}
