import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Plaid webhook handler.
 *
 * Handled events:
 *   TRANSACTIONS / SYNC_UPDATES_AVAILABLE   — incremental sync
 *   TRANSACTIONS / HISTORICAL_UPDATE_COMPLETE — full history now ready; force-resync
 *   TRANSACTIONS / INITIAL_UPDATE_COMPLETE  — initial 30-day batch ready; force-resync
 *
 * Register this URL in the Plaid Dashboard:
 *   https://spine-one.vercel.app/api/plaid/webhook
 * (Must be HTTPS — webhooks won't fire to localhost)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const webhookType: string = body.webhook_type;
    const webhookCode: string = body.webhook_code;
    const itemId: string = body.item_id;

    console.log(`[webhook] Received: type=${webhookType} code=${webhookCode} item=${itemId}`);

    // Only handle TRANSACTIONS webhooks
    if (webhookType !== 'TRANSACTIONS') {
      console.log(`[webhook] Ignoring non-TRANSACTIONS webhook (${webhookType}/${webhookCode})`);
      return NextResponse.json({ received: true });
    }

    const isSync = webhookCode === 'SYNC_UPDATES_AVAILABLE';
    const isHistoricalComplete = webhookCode === 'HISTORICAL_UPDATE_COMPLETE';
    const isInitialComplete = webhookCode === 'INITIAL_UPDATE_COMPLETE';

    if (!isSync && !isHistoricalComplete && !isInitialComplete) {
      return NextResponse.json({ received: true });
    }

    if (!itemId) {
      console.error('[webhook] Missing item_id');
      return NextResponse.json({ error: 'Missing item_id' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: plaidItem, error } = await supabase
      .from('plaid_items')
      .select('user_id')
      .eq('item_id', itemId)
      .single();

    if (error || !plaidItem) {
      console.error('[webhook] Item not found:', itemId, error);
      return NextResponse.json({ received: true });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    if (!appUrl || !appUrl.startsWith('https://')) {
      console.warn('[webhook] NEXT_PUBLIC_APP_URL not set or not HTTPS — skipping auto-sync');
      return NextResponse.json({ received: true });
    }

    console.log(`[webhook] ${webhookCode} for item ${itemId}`);

    if (isHistoricalComplete || isInitialComplete) {
      // Plaid just finished loading the full transaction history from the bank.
      // Use the deep backfill (month-by-month transactionsGet + transactionsSync)
      // rather than a simple sync — this guarantees we capture the entire history.
      console.log(`[webhook] ${webhookCode} — triggering full backfill`);
      const backfillUrl = `${appUrl}/api/plaid/backfill`;
      const backfillRes = await fetch(backfillUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: plaidItem.user_id }),
      });
      if (!backfillRes.ok) {
        const errText = await backfillRes.text();
        console.error('[webhook] Backfill failed:', backfillRes.status, errText);
      } else {
        const result = await backfillRes.json();
        console.log(`[webhook] Backfill complete — db_after=${result.db_after}, net_new=${result.net_new}`);
      }
    } else {
      // SYNC_UPDATES_AVAILABLE — incremental sync only
      const syncUrl = `${appUrl}/api/plaid/sync-transactions`;
      const syncRes = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: plaidItem.user_id, force_resync: false }),
      });
      if (!syncRes.ok) {
        const errText = await syncRes.text();
        console.error('[webhook] Sync failed:', syncRes.status, errText);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
