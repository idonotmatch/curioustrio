ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_user_idempotency_key
  ON expenses (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE duplicate_flags
  ADD COLUMN IF NOT EXISTS score INTEGER,
  ADD COLUMN IF NOT EXISTS match_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

WITH ranked_pairs AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY LEAST(expense_id_a, expense_id_b), GREATEST(expense_id_a, expense_id_b)
           ORDER BY (status = 'pending') DESC, created_at DESC, id DESC
         ) AS pair_rank
  FROM duplicate_flags
)
DELETE FROM duplicate_flags
WHERE id IN (SELECT id FROM ranked_pairs WHERE pair_rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_duplicate_flags_canonical_pair
  ON duplicate_flags (
    LEAST(expense_id_a, expense_id_b),
    GREATEST(expense_id_a, expense_id_b)
  );

CREATE INDEX IF NOT EXISTS idx_duplicate_flags_pending_a
  ON duplicate_flags (expense_id_a, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_duplicate_flags_pending_b
  ON duplicate_flags (expense_id_b, created_at DESC)
  WHERE status = 'pending';
