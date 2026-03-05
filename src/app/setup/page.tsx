"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import HoneycombBackground from "@/components/HoneycombBackground";

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
    <div className="min-h-screen relative">
      <HoneycombBackground />
      <div className="relative z-[1] flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-[500px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-[28px]">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text)]">
            Welcome to Spine
          </h1>
          <p className="mb-8 text-[var(--text-dim)]">
            Connect your health data to your spending
          </p>
          <button
            onClick={loginWithGitHub}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/90 px-6 py-3.5 font-bold text-[#080808] shadow-lg transition-all hover:bg-white hover:shadow-xl"
          >
            Login with GitHub
          </button>
        </div>

        <div className="mt-16 flex gap-8 text-sm text-[var(--text-muted)]">
          <Link href="/privacy" className="text-[var(--gold)] hover:opacity-90">
            Privacy
          </Link>
          <Link href="/data-policy" className="text-[var(--gold)] hover:opacity-90">
            Data Policy
          </Link>
          <Link href="/security-policy" className="text-[var(--gold)] hover:opacity-90">
            Security
          </Link>
        </div>
      </div>
    </div>
  );
}
