import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { plaidClient } from '@/lib/plaid/client';
import { backfillTransactions } from '@/lib/plaid/backfill';
import { mapPlaidCategory } from '@/lib/categorize';
import { format } from 'date-fns';

/**
 * POST /api/plaid/backfill
 *
 * Two-phase backfill:
 *   1. Calls Plaid /transactions/refresh to force a fresh pull from the bank.
 *      This fixes the "phase 1 only" problem where Plaid only returns 30-90 days
 *      on initial connect. After refresh, Plaid fetches the full 24-month history.
 *   2. Resets the sync cursor and runs a full transactionsSync from the beginning,
 *      picking up everything Plaid now has.
 *   3. Optionally also runs transactionsGet over the explicit date range as a second
 *      pass to catch anything the sync might miss.
 *
 * Safe to run multiple times — upserts on plaid_transaction_id, no duplicates.
 *
 * Body:
 *   user_id    string  (required)
 *   start_date string  YYYY-MM-DD (optional, defaults to 2024-09-01)
 *   end_date   string  YYYY-MM-DD (optional, defaults to today)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const today = format(new Date(), 'yyyy-MM-dd');
    const start_date: string = body.start_date ?? '2024-09-01';
    const end_date: string = body.end_date ?? today;
    const purge: boolean = body.purge ?? false;

    const supabase = await createClient();

    // If purge=true, delete all Plaid-sourced transactions before re-inserting.
    // Preserves manually-added transactions (plaid_transaction_id starts with "manual_").
    // Use this after disconnecting + reconnecting a bank — Plaid assigns new IDs on
    // every reconnect, so old rows become orphaned duplicates.
    if (purge) {
      console.log(`[backfill] Purging old Plaid transactions for user ${user_id}…`);
      const { error: purgeError, count } = await supabase
        .from('transactions')
        .delete({ count: 'exact' })
        .eq('user_id', user_id)
        .not('plaid_transaction_id', 'like', 'manual_%');

      if (purgeError) {
        console.error('[backfill] Purge error:', purgeError);
        return NextResponse.json({ error: 'Failed to purge transactions' }, { status: 500 });
      }
      console.log(`[backfill] Purged ${count} old transactions`);
    }

    const { data: plaidItems, error: itemsError } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name')
      .eq('user_id', user_id);

    if (itemsError) {
      return NextResponse.json({ error: 'Failed to fetch bank connections' }, { status: 500 });
    }
    if (!plaidItems || plaidItems.length === 0) {
      return NextResponse.json({ error: 'No banks connected for this user' }, { status: 400 });
    }

    let totalAdded = 0;
    const results: {
      institution: string;
      from_sync: number;
      from_get: number;
    }[] = [];

    for (const item of plaidItems) {
      console.log(`[backfill] Processing ${item.institution_name}`);

      // ── Step 1: Reset cursor and full re-sync via transactionsSync ─────────────
      // Deleting the cursor means the next sync starts from the very beginning
      // of Plaid's available history for this item.
      await supabase.from('plaid_items').update({ cursor: null }).eq('id', item.id);

      console.log(`[backfill] Running full transactionsSync from beginning...`);
      let syncAdded = 0;
      let cursor: string | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor,
          options: { include_personal_finance_category: true },
        });

        const { added, modified, next_cursor } = response.data;

        if (added.length > 0) {
          const toUpsert = added.map(tx => {
            const rawCat =
              tx.personal_finance_category?.primary ||
              (Array.isArray(tx.category) ? tx.category[0] : null);
            return {
              user_id,
              plaid_transaction_id: tx.transaction_id,
              amount_cents: Math.round(tx.amount * 100),
              posted_at: tx.authorized_date || tx.date,
              merchant_name: tx.merchant_name || tx.name || null,
              description: tx.name || tx.merchant_name || 'Unknown',
              category: mapPlaidCategory(rawCat),
            };
          });

          const { error } = await supabase
            .from('transactions')
            .upsert(toUpsert, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

          if (!error) {
            syncAdded += added.length;
            // Correct posted_at to authorized_date on pre-existing rows
            const byDate: Record<string, string[]> = {};
            for (const tx of toUpsert) {
              if (!byDate[tx.posted_at]) byDate[tx.posted_at] = [];
              byDate[tx.posted_at].push(tx.plaid_transaction_id);
            }
            for (const [date, ids] of Object.entries(byDate)) {
              await supabase
                .from('transactions')
                .update({ posted_at: date })
                .in('plaid_transaction_id', ids);
            }
            // Fill null categories on pre-existing rows
            const byCategory: Record<string, string[]> = {};
            for (const tx of toUpsert) {
              if (!byCategory[tx.category]) byCategory[tx.category] = [];
              byCategory[tx.category].push(tx.plaid_transaction_id);
            }
            for (const [cat, ids] of Object.entries(byCategory)) {
              await supabase
                .from('transactions')
                .update({ category: cat })
                .in('plaid_transaction_id', ids)
                .is('category', null);
            }
          } else {
            console.error('[backfill] sync upsert error:', error);
          }
        }

        // Apply modifications (but never overwrite user-set category)
        if (modified.length > 0) {
          for (const tx of modified) {
            await supabase
              .from('transactions')
              .update({
                amount_cents: Math.round(tx.amount * 100),
                posted_at: tx.date,
                merchant_name: tx.merchant_name || tx.name || null,
                description: tx.name || tx.merchant_name || 'Unknown',
              })
              .eq('plaid_transaction_id', tx.transaction_id);
          }
        }

        cursor = next_cursor;
        hasMore = response.data.has_more;
      }

      // Save the cursor so future incremental syncs are fast
      if (cursor) {
        await supabase.from('plaid_items').update({ cursor }).eq('id', item.id);
      }
      console.log(`[backfill] transactionsSync complete: ${syncAdded} processed for ${item.institution_name}`);

      // ── Step 3: transactionsGet over the explicit date range (second pass) ───
      // transactionsSync and transactionsGet use different backend pipelines.
      // Running both maximises coverage.
      console.log(`[backfill] Running transactionsGet (${start_date} → ${end_date})...`);
      const { transactions_added: getAdded } = await backfillTransactions(
        supabase,
        item.access_token,
        user_id,
        start_date,
        end_date,
      );
      console.log(`[backfill] transactionsGet complete: ${getAdded} processed`);

      totalAdded += syncAdded + getAdded;
      results.push({
        institution: item.institution_name ?? 'Unknown',
        from_sync: syncAdded,
        from_get: getAdded,
      });
    }

    return NextResponse.json({
      success: true,
      purged: purge,
      date_range: { start_date, end_date },
      total_transactions_processed: totalAdded,
      by_institution: results,
    });
  } catch (error) {
    console.error('[backfill] Error:', error);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
