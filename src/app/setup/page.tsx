"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import HoneycombBackground from "@/components/HoneycombBackground";

export default function SetupPage() {
  const router = useRouter();
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [isSignUp,    setIsSignUp]    = useState(false);
  const [authError,   setAuthError]   = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => { checkSession(); }, []);

  async function checkSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session) router.push("/dashboard");
  }

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  }

  async function loginWithGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) setAuthError(error.message);
        else       setAuthError("Check your email for a confirmation link.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setAuthError(error.message);
        else       router.push("/dashboard");
      }
    } catch {
      setAuthError("Something went wrong. Please try again.");
    }
    setAuthLoading(false);
  }

  return (
    <div className="min-h-screen relative">
      <HoneycombBackground />
      <div className="relative z-[1] flex min-h-screen flex-col items-center justify-center px-4">

        <div className="w-full max-w-[440px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-[28px]">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--text)]">
            Welcome to Spine
          </h1>
          <p className="mb-8 text-[var(--text-dim)]">
            Connect your health data to your spending
          </p>

          {/* ── Social sign-in ─────────────────────────────────────────────── */}
          <div className="space-y-3 mb-6">
            {/* Google */}
            <button
              onClick={loginWithGoogle}
              className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-3.5 font-semibold text-[#1f1f1f] shadow-sm transition-all hover:bg-gray-50 hover:shadow-md"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            {/* GitHub */}
            <button
              onClick={loginWithGitHub}
              className="w-full inline-flex items-center justify-center gap-3 rounded-xl bg-[#24292e] px-6 py-3.5 font-bold text-white shadow-lg transition-all hover:bg-[#1a1f24] hover:shadow-xl"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
              </svg>
              Continue with GitHub
            </button>
          </div>

          {/* ── Divider ─────────────────────────────────────────────────────── */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border)]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[var(--glass-bg)] px-3 text-[var(--text-muted)] tracking-widest">or</span>
            </div>
          </div>

          {/* ── Email form ──────────────────────────────────────────────────── */}
          <form onSubmit={handleEmailAuth} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className="w-full px-4 py-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] text-[var(--text)] placeholder-[var(--text-muted)] text-sm outline-none focus:ring-2 focus:ring-[var(--gold)]/40 transition-all"
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-4 py-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] text-[var(--text)] placeholder-[var(--text-muted)] text-sm outline-none focus:ring-2 focus:ring-[var(--gold)]/40 transition-all"
            />
            {authError && (
              <p className={`text-xs px-1 ${authError.startsWith("Check") ? "text-[var(--safe)]" : "text-[var(--danger)]"}`}>
                {authError}
              </p>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full px-6 py-3.5 rounded-xl bg-[var(--gold)] text-[#080808] font-bold text-sm shadow-lg hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {authLoading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            {isSignUp ? "Already have an account? " : "Don't have an account? "}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setAuthError(null); }}
              className="text-[var(--gold)] font-medium hover:opacity-80 transition-opacity"
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>

        <div className="mt-16 flex gap-8 text-sm">
          <Link href="/privacy"         className="text-[var(--gold)] hover:opacity-90">Privacy</Link>
          <Link href="/data-policy"     className="text-[var(--gold)] hover:opacity-90">Data Policy</Link>
          <Link href="/security-policy" className="text-[var(--gold)] hover:opacity-90">Security</Link>
        </div>

      </div>
    </div>
  );
}
