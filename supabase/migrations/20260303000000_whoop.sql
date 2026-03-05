-- ─── Whoop Integration Migration ─────────────────────────────────────────────
-- Run this in the Supabase SQL Editor before using the Whoop integration.

-- 1. Add Whoop-specific columns to health_data
ALTER TABLE health_data
  ADD COLUMN IF NOT EXISTS source_device       text    DEFAULT 'apple_watch',
  ADD COLUMN IF NOT EXISTS whoop_recovery_score numeric,
  ADD COLUMN IF NOT EXISTS whoop_strain         numeric,
  ADD COLUMN IF NOT EXISTS whoop_sleep_score    numeric;

-- 2. Create whoop_connections table
CREATE TABLE IF NOT EXISTS whoop_connections (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        REFERENCES auth.users NOT NULL UNIQUE,
  whoop_user_id  bigint,
  access_token   text        NOT NULL,
  refresh_token  text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  scope          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- 3. RLS
ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access own whoop connections" ON whoop_connections;
CREATE POLICY "Users access own whoop connections"
  ON whoop_connections FOR ALL
  USING (auth.uid() = user_id);
