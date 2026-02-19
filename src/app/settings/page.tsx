"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      setUserEmail(data.session.user.email || null);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/setup");
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
      <h1>Settings</h1>

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
        <h3>Account</h3>
        <p>Email: {userEmail}</p>
        <button onClick={logout} style={{ marginTop: 10 }}>
          Sign Out
        </button>
      </div>

      <div style={{ marginTop: 40 }}>
        <h3>Connections</h3>
        <p>🏦 Bank: Not connected (Plaid integration coming)</p>
        <p>💚 Health Data: Not connected (HealthKit integration coming)</p>
      </div>

      {/* Legal & Privacy Section - NEW */}
      <div
        style={{
          marginTop: 50,
          paddingTop: 30,
          borderTop: "1px solid #e5e5e5",
        }}
      >
        <h2
          style={{
            fontSize: 20,
            marginBottom: 20,
            color: "#ffffff",
            fontWeight: "bold",
          }}
        >
          Legal & Privacy
        </h2>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 15,
          }}
        >
          <a
            href="/privacy"
            target="_blank"
            style={{
              color: "#a5b4fc",
              textDecoration: "none",
              fontSize: 16,
              fontWeight: "500",
            }}
          >
            Privacy Policy →
          </a>

          <a
            href="/data-policy"
            target="_blank"
            style={{
              color: "#a5b4fc",
              textDecoration: "none",
              fontSize: 16,
              fontWeight: "500",
            }}
          >
            Data Retention & Deletion Policy →
          </a>

          <a
            href="/security-policy"
            target="_blank"
            style={{
              color: "#a5b4fc",
              textDecoration: "none",
              fontSize: 16,
              fontWeight: "500",
            }}
          >
            Information Security Policy →
          </a>
        </div>

        <p
          style={{
            marginTop: 20,
            fontSize: 14,
            color: "#666",
          }}
        >
          Questions about your data? Email husseinabdou06@gmail.com
        </p>
      </div>
    </main>
  );
}
