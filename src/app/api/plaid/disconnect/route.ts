import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/plaid/disconnect
 *
 * Removes a Plaid item from both Plaid and the local plaid_items table.
 * Transactions are kept so the user doesn't lose their categorized history.
 *
 * Body: { user_id: string, item_id: string }
 */
export async function POST(request: Request) {
  try {
    const { user_id, item_id } = await request.json();

    if (!user_id || !item_id) {
      return NextResponse.json({ error: 'Missing user_id or item_id' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch the item to get the access_token
    const { data: plaidItem, error: fetchError } = await supabase
      .from('plaid_items')
      .select('id, access_token')
      .eq('id', item_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError || !plaidItem) {
      return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
    }

    // Tell Plaid to invalidate the access token
    try {
      await plaidClient.itemRemove({ access_token: plaidItem.access_token });
    } catch (e) {
      // Non-fatal — item may already be removed on Plaid's side
      console.warn('[disconnect] itemRemove failed (non-fatal):', e);
    }

    // Delete all Plaid-sourced transactions for this user.
    // Plaid assigns new transaction_ids on every reconnect, so keeping old rows
    // causes duplicates. Manual transactions (plaid_transaction_id LIKE 'manual_%') are preserved.
    await supabase
      .from('transactions')
      .delete()
      .eq('user_id', user_id)
      .not('plaid_transaction_id', 'like', 'manual_%');

    // Remove the plaid item itself
    const { error: deleteError } = await supabase
      .from('plaid_items')
      .delete()
      .eq('id', item_id)
      .eq('user_id', user_id);

    if (deleteError) {
      console.error('[disconnect] DB delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove bank connection' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disconnect] Error:', error);
    return NextResponse.json({ error: 'Failed to disconnect bank' }, { status: 500 });
  }
}
