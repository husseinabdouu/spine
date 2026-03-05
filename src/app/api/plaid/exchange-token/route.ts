import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';
import { CountryCode } from 'plaid';
import { backfillTransactions, initCursor } from '@/lib/plaid/backfill';
import { format, subMonths } from 'date-fns';

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
        // institutionsGetById can fail for some production institutions; fall back to generic name
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

    // --- Historical backfill (24 months) + cursor initialisation ---
    // Runs synchronously so the user's full history is ready immediately after connect.
    const today = format(new Date(), 'yyyy-MM-dd');
    const twoYearsAgo = format(subMonths(new Date(), 24), 'yyyy-MM-dd');

    console.log(`[exchange-token] Starting 24-month backfill for ${institutionName} (${twoYearsAgo} → ${today})`);

    try {
      const { transactions_added } = await backfillTransactions(
        supabase,
        accessToken,
        user_id,
        twoYearsAgo,
        today,
      );
      console.log(`[exchange-token] Backfill complete: ${transactions_added} transactions`);

      // Initialise the sync cursor so future incremental syncs only fetch deltas
      await initCursor(supabase, accessToken, user_id, insertedItem.id);
      console.log(`[exchange-token] Cursor initialised for item ${insertedItem.id}`);
    } catch (backfillError) {
      // Non-fatal: the bank is connected even if backfill partially fails.
      // The user can re-sync manually or hit /api/plaid/backfill again.
      console.error('[exchange-token] Backfill error (non-fatal):', backfillError);
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