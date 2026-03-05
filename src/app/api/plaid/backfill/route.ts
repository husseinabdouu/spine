import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid/client";
import { mapPlaidCategory } from "@/lib/categorize";
import { format, subMonths, startOfMonth, endOfMonth, parseISO } from "date-fns";

export const maxDuration = 60;

const WEBHOOK_URL = "https://spine-one.vercel.app/api/plaid/webhook";

/**
 * POST /api/plaid/backfill
 *
 * Deep, multi-phase backfill designed to get every transaction from Plaid:
 *
 * Phase 1 — Register webhook (so future changes auto-sync)
 * Phase 2 — Call transactionsRefresh + wait 30s (forces Plaid to re-pull from bank)
 * Phase 3 — Month-by-month transactionsGet (Sept 2025 → today)
 *            Each month is a separate Plaid call → we can see exactly which months
 *            have missing data and guarantee we don't miss any page.
 * Phase 4 — Full transactionsSync from null cursor to capture anything transactionsGet missed
 *
 * All upserts use onConflict: plaid_transaction_id — safe to run multiple times.
 *
 * Body:
 *   user_id    string  (required)
 *   start_date string  YYYY-MM-DD  (optional, defaults to 18 months ago)
 *   end_date   string  YYYY-MM-DD  (optional, defaults to today)
 *   purge      boolean (optional, default false) — delete all Plaid rows first
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const today      = format(new Date(), "yyyy-MM-dd");
    const start_date: string  = body.start_date ?? format(subMonths(new Date(), 18), "yyyy-MM-dd");
    const end_date:   string  = body.end_date ?? today;
    const purge:      boolean = body.purge ?? false;

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
      monthly_results:   { month: string; plaid_count: number; inserted: number }[];
      from_sync:         number;
      plaid_total_claim: number;
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

      // ── Phase 3: month-by-month transactionsGet ───────────────────────────
      // Build month boundaries from start_date to end_date
      const startParsed = parseISO(start_date);
      const endParsed   = parseISO(end_date);

      // Collect all months in range
      const months: { start: string; end: string; label: string }[] = [];
      let cursor = new Date(startParsed.getFullYear(), startParsed.getMonth(), 1);
      while (cursor <= endParsed) {
        months.push({
          label: format(cursor, "yyyy-MM"),
          start: format(startOfMonth(cursor), "yyyy-MM-dd"),
          end:   format(endOfMonth(cursor),   "yyyy-MM-dd"),
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }

      const monthlyResults: { month: string; plaid_count: number; inserted: number }[] = [];
      let plaidTotalClaim = 0;

      for (const { label, start: mStart, end: mEnd } of months) {
        let offset = 0;
        let monthTotal = 0;
        let monthInserted = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: txData } = await plaidClient.transactionsGet({
            access_token: item.access_token,
            start_date:   mStart,
            end_date:     mEnd,
            options: {
              count:  500,
              offset,
              include_personal_finance_category: true,
            },
          });

          monthTotal = txData.total_transactions;
          const txs  = txData.transactions;

          if (txs.length > 0) {
            const rows = txs.map(tx => ({
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

            const { error: upsertErr } = await supabase
              .from("transactions")
              .upsert(rows, { onConflict: "plaid_transaction_id", ignoreDuplicates: true });

            if (!upsertErr) {
              monthInserted += txs.length;

              // Always correct posted_at to authorized_date
              const byDate: Record<string, string[]> = {};
              for (const r of rows) {
                if (!byDate[r.posted_at]) byDate[r.posted_at] = [];
                byDate[r.posted_at].push(r.plaid_transaction_id);
              }
              await Promise.all(
                Object.entries(byDate).map(([date, ids]) =>
                  supabase.from("transactions").update({ posted_at: date }).in("plaid_transaction_id", ids)
                )
              );

              // Fill null categories
              const byCat: Record<string, string[]> = {};
              for (const r of rows) {
                if (!byCat[r.category]) byCat[r.category] = [];
                byCat[r.category].push(r.plaid_transaction_id);
              }
              await Promise.all(
                Object.entries(byCat).map(([cat, ids]) =>
                  supabase.from("transactions").update({ category: cat }).in("plaid_transaction_id", ids).is("category", null)
                )
              );
            } else {
              console.error(`[backfill] upsert error for ${label}:`, upsertErr);
            }
          }

          offset += txs.length;
          if (offset >= monthTotal || txs.length === 0) break;
        }

        plaidTotalClaim += monthTotal;
        monthlyResults.push({ month: label, plaid_count: monthTotal, inserted: monthInserted });
        console.log(`[backfill] ${label}: Plaid has ${monthTotal}, inserted ${monthInserted}`);
      }

      // ── Phase 4: transactionsSync from null cursor (catches anything GET missed) ──
      console.log("[backfill] Phase 4: Full transactionsSync from null cursor…");
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
      console.log(`[backfill] Phase 4 sync reported ${syncTotal} transactions`);

      byInstitution.push({
        institution:       item.institution_name ?? "Unknown",
        webhook_set:       webhookSet,
        refresh_triggered: refreshTriggered,
        monthly_results:   monthlyResults,
        from_sync:         syncTotal,
        plaid_total_claim: plaidTotalClaim,
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
      success:           true,
      purged:            purge,
      date_range:        { start_date, end_date },
      db_before:         countBefore ?? 0,
      db_after:          countAfter  ?? 0,
      net_new:           netNew,
      oldest_in_db:      oldestRow?.[0]?.posted_at ?? null,
      newest_in_db:      newestRow?.[0]?.posted_at ?? null,
      by_institution:    byInstitution,
      diagnosis: netNew === 0 && (countAfter ?? 0) < 400
        ? "Plaid may still be loading your full history. The HISTORICAL_UPDATE_COMPLETE webhook will fire when ready — the webhook is now registered and will auto-sync. Try again in 30 minutes."
        : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill] Fatal:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
