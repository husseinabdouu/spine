import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const supabase = await createClient();

    // Get user's connected banks
    const { data: plaidItems, error: itemsError } = await supabase
      .from('plaid_items')
      .select('*')
      .eq('user_id', user_id);

    if (itemsError) {
      console.error('Error fetching plaid items:', itemsError);
      return NextResponse.json({ error: 'Failed to fetch bank connections' }, { status: 500 });
    }

    if (!plaidItems || plaidItems.length === 0) {
      return NextResponse.json({ error: 'No banks connected' }, { status: 400 });
    }

    let totalAdded = 0;

    // Sync transactions for each connected bank
    for (const item of plaidItems) {
      let hasMore = true;
      let cursor = item.cursor || undefined;

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor: cursor,
        });

        const { added, modified, removed, next_cursor } = response.data;

        // Insert new transactions
        if (added.length > 0) {
          const transactionsToInsert = added.map(tx => ({
            user_id: user_id,
            plaid_transaction_id: tx.transaction_id,
            amount_cents: Math.round(tx.amount * 100),
            posted_at: tx.date,
            merchant_name: tx.merchant_name || tx.name,
            category: tx.category || [],
          }));

          const { error: insertError } = await supabase
            .from('transactions')
            .upsert(transactionsToInsert, {
              onConflict: 'plaid_transaction_id',
              ignoreDuplicates: false
            });

          if (insertError) {
            console.error('Error inserting transactions:', insertError);
          } else {
            totalAdded += added.length;
          }
        }

        // Update modified transactions
        if (modified.length > 0) {
          for (const tx of modified) {
            await supabase
              .from('transactions')
              .update({
                amount_cents: Math.round(tx.amount * 100),
                posted_at: tx.date,
                merchant_name: tx.merchant_name || tx.name,
                category: tx.category || [],
              })
              .eq('plaid_transaction_id', tx.transaction_id);
          }
        }

        // Delete removed transactions
        if (removed.length > 0) {
          const removedIds = removed.map(tx => tx.transaction_id);
          await supabase
            .from('transactions')
            .delete()
            .in('plaid_transaction_id', removedIds);
        }

        // Update cursor
        await supabase
          .from('plaid_items')
          .update({ cursor: next_cursor })
          .eq('id', item.id);

        cursor = next_cursor;
        hasMore = response.data.has_more;
      }
    }

    return NextResponse.json({
      success: true,
      transactions_added: totalAdded
    });

  } catch (error) {
    console.error('Error syncing transactions:', error);
    return NextResponse.json({ error: 'Failed to sync transactions' }, { status: 500 });
  }
}