import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

const env = process.env.PLAID_ENV;
if (!env || !['sandbox', 'development', 'production'].includes(env)) {
  throw new Error(
    'PLAID_ENV must be set to "sandbox", "development", or "production" in environment variables'
  );
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[env as 'sandbox' | 'development' | 'production'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
