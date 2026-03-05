import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { CountryCode, Products } from 'plaid';

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json();

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    const redirectUri =
      appUrl && appUrl.startsWith('https://')
        ? `${appUrl}/dashboard`
        : undefined;
    const webhookUrl =
      appUrl && appUrl.startsWith('https://')
        ? `${appUrl}/api/plaid/webhook`
        : undefined;

    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: user_id,
      },
      client_name: 'Spine',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(redirectUri && { redirect_uri: redirectUri }),
      ...(webhookUrl && { webhook: webhookUrl }),
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    console.error('Error creating link token:', error);
    let message = 'Failed to create link token';
    if (error instanceof Error) {
      message = error.message;
    }
    if (error && typeof error === 'object' && 'response' in error) {
      const res = (error as { response?: { data?: unknown } }).response?.data;
      if (res && typeof res === 'object') {
        const d = res as { error_message?: string; error_code?: string; display_message?: string };
        message = d.error_message || d.display_message || d.error_code || message;
      }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}