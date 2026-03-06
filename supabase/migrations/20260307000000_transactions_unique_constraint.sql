-- Add UNIQUE constraint on plaid_transaction_id so upserts deduplicate correctly.
-- Without this constraint, upsert({ onConflict: "plaid_transaction_id" }) falls back
-- to a plain insert and every backfill run creates duplicates.
--
-- Before adding the constraint, remove any existing duplicates (keeping the first
-- inserted row per plaid_transaction_id).

DELETE FROM transactions
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY plaid_transaction_id
             ORDER BY id
           ) AS rn
    FROM transactions
    WHERE plaid_transaction_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_plaid_transaction_id_key
  UNIQUE (plaid_transaction_id);
