import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export const createClient = () => {
  // Use service role key to bypass RLS in API routes
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
};