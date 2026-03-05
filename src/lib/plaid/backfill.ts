import { plaidClient } from './client';
import { mapPlaidCategory } from '@/lib/categorize';
import { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 500;

/**
 * Returns the best available date for a transaction.
 * authorized_date = the day you actually tapped/swiped (accurate).
 * date            = the settlement/confirmation date (days later, inaccurate).
 * We always prefer authorized_date so pending→confirmed transitions don't shift
 * the transaction to a later date.
 */
function bestDate(authorized_date: string | null | undefined, date: string): string {
  return authorized_date || date;
}

/**
 * Pulls all transactions for a connected Plaid item over a given date range using
 * /transactions/get (pagination via offset) and upserts them into the transactions table.
 *
 * - Uses ignoreDuplicates so user-set categories are never overwritten.
 * - Always corrects posted_at to the authorized_date (actual spend date).
 * - Fills in null categories as a second pass.
 */
export async function backfillTransactions(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
): Promise<{ transactions_added: number }> {
  let offset = 0;
  let totalAdded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: PAGE_SIZE,
        offset,
        include_personal_finance_category: true,
      },
    });

    const { transactions, total_transactions } = response.data;

    if (transactions.length > 0) {
      const toUpsert = transactions.map(tx => ({
        user_id: userId,
        plaid_transaction_id: tx.transaction_id,
        amount_cents: Math.round(tx.amount * 100),
        posted_at: bestDate(tx.authorized_date, tx.date),
        merchant_name: tx.merchant_name || tx.name || null,
        description: tx.name || tx.merchant_name || 'Unknown',
        category: mapPlaidCategory(
          tx.personal_finance_category?.primary ||
          (Array.isArray(tx.category) ? tx.category[0] : null)
        ),
      }));

      // Insert new rows (ignoreDuplicates preserves user-set categories)
      const { error } = await supabase
        .from('transactions')
        .upsert(toUpsert, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

      if (error) {
        console.error('[backfill] upsert error:', error);
      } else {
        totalAdded += transactions.length;
      }

      // Always correct posted_at on existing rows — date accuracy is factual, not user preference.
      // Group by date to minimise round-trips.
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

      // Fill in category for rows that exist but still have null category
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
    }

    offset += transactions.length;

    if (offset >= total_transactions || transactions.length === 0) break;
  }

  return { transactions_added: totalAdded };
}

/**
 * After a backfill, runs one pass of transactionsSync with no cursor to initialise
 * the cursor in plaid_items. This ensures future incremental syncs only fetch deltas.
 */
export async function initCursor(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  plaidItemId: string,
): Promise<void> {
  let cursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
      options: { include_personal_finance_category: true },
    });

    const { added, next_cursor } = response.data;

    if (added.length > 0) {
      const toUpsert = added.map(tx => ({
        user_id: userId,
        plaid_transaction_id: tx.transaction_id,
        amount_cents: Math.round(tx.amount * 100),
        posted_at: bestDate(tx.authorized_date, tx.date),
        merchant_name: tx.merchant_name || tx.name || null,
        description: tx.name || tx.merchant_name || 'Unknown',
        category: mapPlaidCategory(
          tx.personal_finance_category?.primary ||
          (Array.isArray(tx.category) ? tx.category[0] : null)
        ),
      }));

      await supabase
        .from('transactions')
        .upsert(toUpsert, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

      // Correct posted_at on any pre-existing rows
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
    }

    cursor = next_cursor;
    hasMore = response.data.has_more;
  }

  if (cursor) {
    await supabase
      .from('plaid_items')
      .update({ cursor })
      .eq('id', plaidItemId);
  }
}
