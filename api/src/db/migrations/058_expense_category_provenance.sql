ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category_source TEXT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category_confidence INTEGER;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category_reasoning JSONB;
