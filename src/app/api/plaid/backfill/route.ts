import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid/client";
import { mapPlaidCategory } from "@/lib/categorize";
import { format } from "date-fns";

export const maxDuration = 60;

const WEBHOOK_URL = "https://spine-one.vercel.app/api/plaid/webhook";

/**
 * POST /api/plaid/backfill
 *
 * Backfill using only transactionsSync (never transactionsGet).
 * Using both APIs generates different transaction_id strings for the same
 * bank transaction, bypassing the unique constraint and creating duplicates.
 *
 * Phase 1 — Register webhook (so future changes auto-sync)
 * Phase 2 — Call transactionsRefresh + wait 30s (forces Plaid to re-pull from bank)
 * Phase 3 — Full transactionsSync from null cursor — returns everything Plaid has
 *
 * All upserts use onConflict: plaid_transaction_id — safe to run multiple times.
 *
 * Body:
 *   user_id    string  (required)
 *   purge      boolean (optional, default false) — delete all Plaid rows first, then re-sync
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const purge: boolean = body.purge ?? false;

    const supabase = await createClient();

    // ── Optional purge ───────────────────────────────────────────────────────
    if (purge) {
      console.log(`[backfill] Purging old Plaid transactions for user ${user_id}…`);
      const { error: purgeError, count } = await supabase
        .from("transactions")
        .delete({ count: "exact" })
        .eq("user_id", user_id)
        .not("plaid_transaction_id", "like", "manual_%");
      if (purgeError) {
        return NextResponse.json({ error: "Purge failed: " + purgeError.message }, { status: 500 });
      }
      console.log(`[backfill] Purged ${count} rows`);
    }

    // ── Fetch connected Plaid items ──────────────────────────────────────────
    const { data: plaidItems, error: itemsErr } = await supabase
      .from("plaid_items")
      .select("id, access_token, institution_name, cursor")
      .eq("user_id", user_id);

    if (itemsErr || !plaidItems?.length) {
      return NextResponse.json({ error: "No banks connected for this user" }, { status: 400 });
    }

    // Count DB rows before we start
    const { count: countBefore } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .not("plaid_transaction_id", "like", "manual_%");

    const byInstitution: {
      institution:       string;
      webhook_set:       boolean;
      refresh_triggered: boolean;
      from_sync:         number;
    }[] = [];

    for (const item of plaidItems) {
      console.log(`[backfill] ── ${item.institution_name} ──────────────────────────`);

      // ── Phase 1: Register webhook ─────────────────────────────────────────
      let webhookSet = false;
      try {
        await plaidClient.itemWebhookUpdate({
          access_token: item.access_token,
          webhook: WEBHOOK_URL,
        });
        webhookSet = true;
        console.log(`[backfill] Webhook registered → ${WEBHOOK_URL}`);
      } catch (e: unknown) {
        console.warn("[backfill] itemWebhookUpdate failed:", (e as { response?: { data?: unknown } })?.response?.data ?? e);
      }

      // ── Phase 2: transactionsRefresh + 30s wait ───────────────────────────
      let refreshTriggered = false;
      try {
        await plaidClient.transactionsRefresh({ access_token: item.access_token });
        refreshTriggered = true;
        console.log("[backfill] transactionsRefresh fired — waiting 30s for Plaid to process…");
        await new Promise(r => setTimeout(r, 30_000));
      } catch (e: unknown) {
        const errData = (e as { response?: { data?: unknown } })?.response?.data ?? e;
        console.warn("[backfill] transactionsRefresh failed (non-fatal):", JSON.stringify(errData));
      }

      // ── Phase 3: transactionsSync from null cursor ───────────────────────────
      // Reset cursor so we get ALL transactions from Plaid, not just new ones.
      // This is the only API we use — mixing transactionsGet would generate
      // different transaction IDs for the same bank transactions = duplicates.
      console.log("[backfill] Phase 3: Full transactionsSync from null cursor…");
      await supabase.from("plaid_items").update({ cursor: null }).eq("id", item.id);

      let syncCursor: string | undefined = undefined;
      let hasMore = true;
      let syncTotal = 0;

      while (hasMore) {
        const { data: syncData } = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor: syncCursor,
          options: { include_personal_finance_category: true },
        });

        const { added, modified, next_cursor } = syncData;
        syncTotal += added.length;

        if (added.length > 0) {
          const rows = added.map(tx => ({
            user_id,
            plaid_transaction_id: tx.transaction_id,
            amount_cents:  Math.round(tx.amount * 100),
            posted_at:     tx.authorized_date || tx.date,
            merchant_name: tx.merchant_name || tx.name || null,
            description:   tx.name || tx.merchant_name || "Unknown",
            category:      mapPlaidCategory(
              tx.personal_finance_category?.primary ||
              (Array.isArray(tx.category) ? tx.category[0] : null)
            ),
          }));

          await supabase
            .from("transactions")
            .upsert(rows, { onConflict: "plaid_transaction_id", ignoreDuplicates: true });
        }

        if (modified.length > 0) {
          for (const tx of modified) {
            await supabase
              .from("transactions")
              .update({
                amount_cents:  Math.round(tx.amount * 100),
                posted_at:     tx.authorized_date || tx.date,
                merchant_name: tx.merchant_name || tx.name || null,
                description:   tx.name || tx.merchant_name || "Unknown",
              })
              .eq("plaid_transaction_id", tx.transaction_id);
          }
        }

        syncCursor = next_cursor;
        hasMore = syncData.has_more;
      }

      // Save final cursor
      if (syncCursor) {
        await supabase.from("plaid_items").update({ cursor: syncCursor }).eq("id", item.id);
      }
      console.log(`[backfill] Sync reported ${syncTotal} transactions`);

      byInstitution.push({
        institution:       item.institution_name ?? "Unknown",
        webhook_set:       webhookSet,
        refresh_triggered: refreshTriggered,
        from_sync:         syncTotal,
      });
    }

    // ── Final DB count ───────────────────────────────────────────────────────
    const { count: countAfter } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id);

    const { data: oldestRow } = await supabase
      .from("transactions")
      .select("posted_at")
      .eq("user_id", user_id)
      .order("posted_at", { ascending: true })
      .limit(1);

    const { data: newestRow } = await supabase
      .from("transactions")
      .select("posted_at")
      .eq("user_id", user_id)
      .order("posted_at", { ascending: false })
      .limit(1);

    const netNew = (countAfter ?? 0) - (countBefore ?? 0);

    return NextResponse.json({
      success:        true,
      purged:         purge,
      db_before:      countBefore ?? 0,
      db_after:       countAfter  ?? 0,
      net_new:        netNew,
      oldest_in_db:   oldestRow?.[0]?.posted_at ?? null,
      newest_in_db:   newestRow?.[0]?.posted_at ?? null,
      by_institution: byInstitution,
      note: netNew === 0 && (countAfter ?? 0) < 400
        ? "Plaid may still be loading your full history. HISTORICAL_UPDATE_COMPLETE webhook will fire when ready and auto-sync everything."
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill] Fatal:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
