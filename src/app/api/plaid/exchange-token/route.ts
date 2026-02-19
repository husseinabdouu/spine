import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { createClient } from '@/lib/supabase/server';
import { CountryCode } from 'plaid';

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
      const institutionResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = institutionResponse.data.institution.name;
    }

    const { error: dbError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user_id,
        access_token: accessToken,
        item_id: itemId,
        institution_name: institutionName,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json({ error: 'Failed to save bank connection' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      institution_name: institutionName
    });

  } catch (error) {
    console.error('Error exchanging token:', error);
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
  }
}