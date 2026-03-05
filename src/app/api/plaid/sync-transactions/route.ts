import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';
import { mapPlaidCategory } from '@/lib/categorize';

export async function POST(request: Request) {
  try {
    const { user_id, force_resync } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: plaidItems, error: itemsError } = await supabase
      .from('plaid_items')
      .select('*')
      .eq('user_id', user_id);

    if (itemsError) {
      return NextResponse.json({ error: 'Failed to fetch bank connections' }, { status: 500 });
    }

    if (!plaidItems || plaidItems.length === 0) {
      return NextResponse.json({ error: 'No banks connected' }, { status: 400 });
    }

    let totalAdded = 0;

    for (const item of plaidItems) {
      let hasMore = true;
      let cursor = force_resync ? undefined : (item.cursor || undefined);

      if (force_resync) {
        await supabase.from('plaid_items').update({ cursor: null }).eq('id', item.id);
      }

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor: cursor,
          options: { include_personal_finance_category: true },
        });

        const { added, modified, removed, next_cursor } = response.data;

        if (added.length > 0) {
          const toInsert = added.map(tx => ({
            user_id,
            plaid_transaction_id: tx.transaction_id,
            amount_cents: Math.round(tx.amount * 100),
            posted_at: tx.authorized_date || tx.date,
            merchant_name: tx.merchant_name || tx.name || null,
            description: tx.name || tx.merchant_name || 'Unknown',
            category: mapPlaidCategory(
              tx.personal_finance_category?.primary ||
              (Array.isArray(tx.category) ? tx.category[0] : tx.category)
            ),
          }));

          // Step 1: Insert new transactions. ignoreDuplicates preserves user-set categories.
          const { error: insertError } = await supabase
            .from('transactions')
            .upsert(toInsert, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

          if (insertError) {
            console.error('Insert error:', insertError);
          } else {
            totalAdded += added.length;
          }

          // Step 2: Correct posted_at on any pre-existing rows (authorized_date is the real spend date)
          const byDate: Record<string, string[]> = {};
          for (const tx of toInsert) {
            if (!byDate[tx.posted_at]) byDate[tx.posted_at] = [];
            byDate[tx.posted_at].push(tx.plaid_transaction_id);
          }
          for (const [date, ids] of Object.entries(byDate)) {
            await supabase
              .from('transactions')
              .update({ posted_at: date })
              .in('plaid_transaction_id', ids);
          }

          // Step 3: For existing transactions that still have null category, fill them in
          // grouped by category to minimise round-trips (one query per category, not per row)
          const byCategory: Record<string, string[]> = {};
          for (const tx of toInsert) {
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

        // Update amounts/dates/merchants for modified transactions — but NOT category
        if (modified.length > 0) {
          for (const tx of modified) {
            await supabase
              .from('transactions')
              .update({
                amount_cents: Math.round(tx.amount * 100),
                posted_at: tx.authorized_date || tx.date,
                merchant_name: tx.merchant_name || tx.name || null,
                description: tx.name || tx.merchant_name || 'Unknown',
              })
              .eq('plaid_transaction_id', tx.transaction_id);
          }
        }

        if (removed.length > 0) {
          const removedIds = removed.map(tx => tx.transaction_id);
          await supabase.from('transactions').delete().in('plaid_transaction_id', removedIds);
        }

        const isInitialEmptySync = !cursor && added.length === 0 && modified.length === 0 && removed.length === 0;
        await supabase
          .from('plaid_items')
          .update({ cursor: isInitialEmptySync ? null : next_cursor })
          .eq('id', item.id);

        cursor = next_cursor;
        hasMore = response.data.has_more;
      }
    }

    return NextResponse.json({ success: true, transactions_added: totalAdded });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: 'Failed to sync transactions' }, { status: 500 });
  }
}
