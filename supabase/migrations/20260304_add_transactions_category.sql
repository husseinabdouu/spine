-- Add category column to transactions (required for Plaid sync)
-- Run this in Supabase SQL Editor if your transactions table doesn't have it
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category text;
