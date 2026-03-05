"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";

const LINK_TOKEN_KEY = "plaid_link_token";

interface PlaidLinkProps {
  onSuccess: () => void;
}

export default function PlaidLink({ onSuccess }: PlaidLinkProps) {
  const { toast } = useToast();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | undefined>(undefined);
  const hasTokenRef = useRef(false);

  const fetchLinkToken = useCallback(async () => {
    hasTokenRef.current = false;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    setUserId(user.id);
    setLoadError(false);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await response.json();

      if (!response.ok || !data.link_token) {
        setLoadError(true);
        setErrorMessage(data.error || "Failed to create link token");
        setLinkToken(null);
        return;
      }

      hasTokenRef.current = true;
      setLinkToken(data.link_token);
      if (typeof window !== "undefined") {
        localStorage.setItem(LINK_TOKEN_KEY, data.link_token);
      }
    } catch (err) {
      setLoadError(true);
      setErrorMessage(err instanceof Error ? err.message : "Network error");
      setLinkToken(null);
    }
  }, []);

  useEffect(() => {
    // Check if returning from OAuth redirect
    if (typeof window !== "undefined" && window.location.href.includes("oauth_state_id=")) {
      const stored = localStorage.getItem(LINK_TOKEN_KEY);
      if (stored) {
        setLinkToken(stored);
        setReceivedRedirectUri(window.location.href);
        hasTokenRef.current = true;
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) setUserId(user.id);
        });
        return;
      }
    }
    fetchLinkToken();

    // If we don't have a token after 15s, show retry instead of infinite Loading
    const timeout = setTimeout(() => {
      if (!hasTokenRef.current) {
        setLoadError(true);
        setErrorMessage((prev) => prev || "Request timed out");
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, [fetchLinkToken]);

  const onPlaidSuccess = useCallback(
    async (public_token: string) => {
      if (typeof window !== "undefined") {
        localStorage.removeItem(LINK_TOKEN_KEY);
      }
      setIsExchanging(true);
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id ?? userId;
      if (!uid) {
        setIsExchanging(false);
        toast("Session expired. Please refresh and try again.", "error");
        return;
      }

      try {
        const response = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token, user_id: uid }),
        });
        const data = await response.json();

        if (!response.ok) {
          toast(data.error || "Failed to connect bank. Please try again.", "error");
          return;
        }

        onSuccess();
      } catch (err) {
        console.error("Exchange error:", err);
        toast("Failed to connect bank. Please try again.", "error");
      } finally {
        setIsExchanging(false);
      }
    },
    [onSuccess, userId],
  );

  const onPlaidExit = useCallback(
    (err: { error_code?: string; error_message?: string } | null, metadata?: { status?: string; link_session_id?: string }) => {
      if (err) {
        console.error("Plaid exit error:", err, metadata);
        const msg = err.error_message || err.error_code || "Connection was not completed.";
        toast(`Plaid: ${msg}`, "error");
      } else if (metadata?.status && metadata.status !== "user_exited") {
        // User didn't manually exit; something else happened (e.g. requires_oauth)
        console.warn("Plaid exit metadata:", metadata);
        toast(`Plaid exited: ${metadata.status}. Try again or use a different bank.`, "info");
      }
    },
    [],
  );

  const config = {
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: onPlaidExit,
    ...(receivedRedirectUri && { receivedRedirectUri }),
  };

  const { open, ready } = usePlaidLink(config);

  // Auto-open when returning from OAuth redirect
  useEffect(() => {
    if (receivedRedirectUri && ready && linkToken) {
      open();
      // Clear the redirect URI from URL and state after opening
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", window.location.pathname);
        setReceivedRedirectUri(undefined);
      }
    }
  }, [receivedRedirectUri, ready, linkToken, open]);

  const handleRetry = () => {
    setIsRetrying(true);
    fetchLinkToken().finally(() => setIsRetrying(false));
  };

  // When token failed to load, show Connect button with retry instead of infinite Loading
  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 14, color: "#666", margin: 0 }}>
          {errorMessage || "Could not load Plaid. Check your connection."}
        </p>
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            cursor: isRetrying ? "not-allowed" : "pointer",
            backgroundColor: "#10b981",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
          }}
        >
          {isRetrying ? "Retrying..." : "Connect Bank Account"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready || isExchanging}
      style={{
        padding: "12px 24px",
        fontSize: 16,
        cursor: ready && !isExchanging ? "pointer" : "not-allowed",
        backgroundColor: "#10b981",
        color: "#ffffff",
        border: "none",
        borderRadius: 8,
      }}
    >
      {isExchanging ? "Connecting..." : ready ? "Connect Bank Account" : "Loading..."}
    </button>
  );
}
