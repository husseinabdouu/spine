"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// After OAuth (GitHub / Google), Supabase redirects here with a ?code= param.
// The Supabase JS client automatically exchanges that code for a session when
// it initialises on this page, then we forward to the dashboard.
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Give the Supabase client a moment to exchange the code for a session.
    const wait = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace("/dashboard");
      } else {
        // Listen once for the session to be established via the code exchange.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            if (event === "SIGNED_IN" && session) {
              subscription.unsubscribe();
              router.replace("/dashboard");
            }
          },
        );
        // Safety fallback — if nothing happens in 5 s, send to setup.
        setTimeout(() => {
          subscription.unsubscribe();
          router.replace("/setup");
        }, 5000);
      }
    };
    wait();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-[var(--text-muted)] text-sm animate-pulse">Signing you in…</p>
    </div>
  );
}
