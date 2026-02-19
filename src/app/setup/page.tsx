"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Checking auth...");

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      router.push("/dashboard");
    } else {
      setStatus("Not logged in");
    }
  }

  async function loginWithGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        maxWidth: 500,
        margin: "100px auto",
      }}
    >
      <h1>Welcome to Spine</h1>
      <p>Connect your health data to your spending</p>
      <br />
      <button
        onClick={loginWithGitHub}
        style={{
          padding: "12px 24px",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        Login with GitHub
      </button>

      {/* Footer with policy links - NEW */}
      <div
        style={{
          marginTop: 60,
          paddingTop: 30,
          borderTop: "1px solid #e5e5e5",
          textAlign: "center",
          fontSize: 14,
          color: "#666",
        }}
      >
        <a
          href="/privacy"
          target="_blank"
          style={{ color: "#6366f1", marginRight: 20, textDecoration: "none" }}
        >
          Privacy
        </a>
        <a
          href="/data-policy"
          target="_blank"
          style={{ color: "#6366f1", marginRight: 20, textDecoration: "none" }}
        >
          Data Policy
        </a>
        <a
          href="/security-policy"
          target="_blank"
          style={{ color: "#6366f1", textDecoration: "none" }}
        >
          Security
        </a>
      </div>
    </main>
  );
}
