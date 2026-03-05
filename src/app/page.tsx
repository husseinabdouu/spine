"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import HoneycombBackground from "@/components/HoneycombBackground";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      router.push("/dashboard");
    } else {
      router.push("/setup");
    }
  }

  return (
    <div className="min-h-screen relative">
      <HoneycombBackground />
      <div className="relative z-[1] flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--text-dim)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--gold)]" />
          <span>Loading...</span>
        </div>
      </div>
    </div>
  );
}
