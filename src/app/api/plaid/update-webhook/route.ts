import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/plaid/update-webhook
 *
 * Updates the webhook URL on all existing Plaid items for a user.
 * Necessary when the item was created without a webhook URL (e.g. from localhost).
 * After this runs, Plaid will start firing SYNC_UPDATES_AVAILABLE and
 * HISTORICAL_UPDATE_COMPLETE to our endpoint.
 *
 * Body: { user_id: string }
 */
export async function POST(request: Request) {
  try {
    const { user_id } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const webhookUrl = 'https://spine-one.vercel.app/api/plaid/webhook';

    const supabase = await createClient();
    const { data: plaidItems, error } = await supabase
      .from('plaid_items')
      .select('id, access_token, institution_name')
      .eq('user_id', user_id);

    if (error || !plaidItems?.length) {
      return NextResponse.json({ error: 'No connected banks found' }, { status: 400 });
    }

    const results: { institution: string; success: boolean; error?: string }[] = [];

    for (const item of plaidItems) {
      try {
        await plaidClient.itemWebhookUpdate({
          access_token: item.access_token,
          webhook: webhookUrl,
        });
        results.push({ institution: item.institution_name ?? 'Unknown', success: true });
        console.log(`[update-webhook] Set webhook for ${item.institution_name}`);
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { error_message?: string } } })?.response?.data?.error_message ?? String(e);
        results.push({ institution: item.institution_name ?? 'Unknown', success: false, error: msg });
        console.error(`[update-webhook] Failed for ${item.institution_name}:`, msg);
      }
    }

    return NextResponse.json({ success: true, webhook_url: webhookUrl, results });
  } catch (error) {
    console.error('[update-webhook] Error:', error);
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
  }
}
