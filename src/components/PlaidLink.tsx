"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { supabase } from "@/lib/supabase/client";

interface PlaidLinkProps {
  onSuccess: () => void;
}

export default function PlaidLink({ onSuccess }: PlaidLinkProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getUserAndCreateToken();
  }, []);

  const getUserAndCreateToken = async () => {
    // Get user ID
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
      createLinkToken(user.id);
    }
  };

  const createLinkToken = async (uid: string) => {
    const response = await fetch("/api/plaid/create-link-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: uid }),
    });
    const data = await response.json();
    setLinkToken(data.link_token);
  };

  const onPlaidSuccess = useCallback(
    async (public_token: string) => {
      await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token, user_id: userId }),
      });

      onSuccess();
    },
    [onSuccess, userId],
  );

  const config = {
    token: linkToken,
    onSuccess: onPlaidSuccess,
  };

  const { open, ready } = usePlaidLink(config);

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{
        padding: "12px 24px",
        fontSize: 16,
        cursor: ready ? "pointer" : "not-allowed",
        backgroundColor: "#10b981",
        color: "#ffffff",
        border: "none",
        borderRadius: 8,
      }}
    >
      {ready ? "Connect Bank Account" : "Loading..."}
    </button>
  );
}
