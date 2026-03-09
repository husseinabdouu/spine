import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';
import { CountryCode } from 'plaid';
import { mapPlaidCategory } from '@/lib/categorize';

export async function POST(request: Request) {
  try {
    const { public_token, user_id } = await request.json();

    if (!public_token || !user_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = await createClient();

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });

    const institutionId = itemResponse.data.item.institution_id;
    let institutionName = 'Unknown Bank';

    if (institutionId) {
      try {
        const institutionResponse = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = institutionResponse.data.institution.name;
      } catch {
        institutionName = 'Connected Bank';
      }
    }

    const { data: insertedItem, error: dbError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user_id,
        access_token: accessToken,
        item_id: itemId,
        institution_name: institutionName,
      })
      .select('id')
      .single();

    if (dbError || !insertedItem) {
      console.error('Database error:', dbError);
      return NextResponse.json({ error: 'Failed to save bank connection' }, { status: 500 });
    }

    // --- Full history pull using transactionsSync from null cursor ---
    // Using transactionsSync (not transactionsGet) ensures Plaid generates the same
    // transaction_id strings as future incremental syncs — mixing both APIs creates
    // duplicate rows because they generate different IDs for the same transaction.
    // Starting from a null cursor returns ALL available history with no date cap.
    console.log(`[exchange-token] Starting full-history sync for ${institutionName}`);

    try {
      let cursor: string | undefined = undefined;
      let hasMore = true;
      let totalAdded = 0;

      while (hasMore) {
        const { data: syncData } = await plaidClient.transactionsSync({
          access_token: accessToken,
          cursor,
          options: { include_personal_finance_category: true },
        });

        const { added, next_cursor } = syncData;

        if (added.length > 0) {
          const rows = added.map(tx => ({
            user_id,
            plaid_transaction_id: tx.transaction_id,
            amount_cents: Math.round(tx.amount * 100),
            posted_at: tx.authorized_date || tx.date,
            merchant_name: tx.merchant_name || tx.name || null,
            description: tx.name || tx.merchant_name || 'Unknown',
            category: mapPlaidCategory(
              tx.personal_finance_category?.primary ||
              (Array.isArray(tx.category) ? tx.category[0] : null)
            ),
          }));

          const { error: upsertErr } = await supabase
            .from('transactions')
            .upsert(rows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: true });

          if (upsertErr) {
            console.error('[exchange-token] Upsert error:', upsertErr);
          } else {
            totalAdded += added.length;
          }
        }

        cursor = next_cursor;
        hasMore = syncData.has_more;
      }

      // Store the final cursor so future incremental syncs only fetch deltas
      if (cursor) {
        await supabase
          .from('plaid_items')
          .update({ cursor })
          .eq('id', insertedItem.id);
      }

      console.log(`[exchange-token] Full-history sync complete: ${totalAdded} transactions, cursor stored`);
    } catch (syncError) {
      // Non-fatal: bank is connected even if the initial pull partially fails.
      // User can re-sync via Settings → Backfill.
      console.error('[exchange-token] Sync error (non-fatal):', syncError);
    }

    return NextResponse.json({
      success: true,
      institution_name: institutionName,
    });

  } catch (error) {
    console.error('Error exchanging token:', error);
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
  }
}
