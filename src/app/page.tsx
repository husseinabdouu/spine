"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

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
    <div style={{ padding: 24 }}>
      <p>Loading...</p>
    </div>
  );
}
