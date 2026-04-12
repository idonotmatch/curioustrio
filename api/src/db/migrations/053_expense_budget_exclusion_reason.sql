ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS budget_exclusion_reason TEXT;
