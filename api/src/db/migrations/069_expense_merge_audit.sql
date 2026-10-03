ALTER TABLE duplicate_flags
  DROP CONSTRAINT IF EXISTS duplicate_flags_status_check;

ALTER TABLE duplicate_flags
  ADD CONSTRAINT duplicate_flags_status_check
  CHECK (status IN ('pending', 'kept_both', 'dismissed', 'replaced', 'merged'));

CREATE TABLE IF NOT EXISTS expense_merge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surviving_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  merged_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  duplicate_flag_id UUID REFERENCES duplicate_flags(id) ON DELETE SET NULL,
  field_sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_items_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_merge_events_survivor
  ON expense_merge_events (surviving_expense_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_merge_events_merged
  ON expense_merge_events (merged_expense_id, created_at DESC);
