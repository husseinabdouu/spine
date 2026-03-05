-- ─── Extended Whoop metrics migration ───────────────────────────────────────
-- Run this in the Supabase SQL Editor before using the updated Whoop backfill.

ALTER TABLE health_data
  ADD COLUMN IF NOT EXISTS resting_heart_rate  numeric,
  ADD COLUMN IF NOT EXISTS whoop_calories       numeric,
  ADD COLUMN IF NOT EXISTS whoop_rem_mins       numeric,
  ADD COLUMN IF NOT EXISTS whoop_deep_mins      numeric,
  ADD COLUMN IF NOT EXISTS whoop_light_mins     numeric;
