ALTER TABLE expense_merge_events
  ADD COLUMN IF NOT EXISTS survivor_before JSONB,
  ADD COLUMN IF NOT EXISTS merged_before JSONB,
  ADD COLUMN IF NOT EXISTS transferred_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_expense_merge_events_user_created
  ON expense_merge_events (user_id, created_at DESC);
