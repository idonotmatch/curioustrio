ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_mode TEXT,
  ADD COLUMN IF NOT EXISTS review_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_review_mode_check'
  ) THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_review_mode_check
      CHECK (review_mode IS NULL OR review_mode IN ('quick_check', 'items_first', 'full_review'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_review_source_check'
  ) THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_review_source_check
      CHECK (review_source IS NULL OR review_source IN ('gmail'));
  END IF;
END $$;

UPDATE expenses
SET review_required = TRUE,
    review_source = 'gmail'
WHERE source = 'email'
  AND status = 'pending'
  AND (review_source IS NULL OR review_source = 'gmail');
