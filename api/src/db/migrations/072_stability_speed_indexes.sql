-- Common list and review paths filter by owner/scope and status before sorting.
CREATE INDEX IF NOT EXISTS idx_expenses_user_confirmed_date_created
  ON expenses (user_id, date DESC, created_at DESC, id DESC)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_expenses_user_pending_date_created
  ON expenses (user_id, date DESC, created_at DESC, id DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_expenses_household_confirmed_date_created
  ON expenses (household_id, date DESC, created_at DESC, id DESC)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_expenses_household_pending_date_created
  ON expenses (household_id, date DESC, created_at DESC, id DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_expense_items_expense_created
  ON expense_items (expense_id, created_at DESC);
