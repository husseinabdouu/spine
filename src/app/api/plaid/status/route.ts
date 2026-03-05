import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';
import { format, subMonths } from 'date-fns';

/**
 * GET /api/plaid/status?user_id=xxx
 * Diagnostic endpoint — shows exactly what Plaid reports for this item
 * without writing anything to the DB.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get('user_id');
  if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: items } = await supabase
    .from('plaid_items')
    .select('id, access_token, institution_name, cursor, created_at')
    .eq('user_id', user_id);

  if (!items?.length) return NextResponse.json({ error: 'No items' }, { status: 404 });

  const results = [];

  for (const item of items) {
    // Check item status
    const itemInfo = await plaidClient.itemGet({ access_token: item.access_token });
    const plaidItem = itemInfo.data.item;

    // Check what transactionsGet reports as total
    const today = format(new Date(), 'yyyy-MM-dd');
    const twoYearsAgo = format(subMonths(new Date(), 24), 'yyyy-MM-dd');

    const getResp = await plaidClient.transactionsGet({
      access_token: item.access_token,
      start_date: twoYearsAgo,
      end_date: today,
      options: { count: 1, offset: 0, include_personal_finance_category: true },
    });

    // One transactionsSync page to see cursor state
    const syncResp = await plaidClient.transactionsSync({
      access_token: item.access_token,
      cursor: item.cursor ?? undefined,
      options: { include_personal_finance_category: true },
    });

    // Count in our DB
    const { count: dbCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .not('plaid_transaction_id', 'like', 'manual_%');

    results.push({
      institution: item.institution_name,
      item_id: plaidItem.item_id,
      webhook: plaidItem.webhook,
      available_products: plaidItem.available_products,
      billed_products: plaidItem.billed_products,
      consent_expiration_time: plaidItem.consent_expiration_time,
      transactions_get: {
        total_transactions_plaid_reports: getResp.data.total_transactions,
        date_range: `${twoYearsAgo} → ${today}`,
      },
      transactions_sync: {
        has_more: syncResp.data.has_more,
        added_on_this_page: syncResp.data.added.length,
        cursor_set: !!item.cursor,
      },
      spine_db_count: dbCount,
    });
  }

  return NextResponse.json({ results });
}
