ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS resolution_action TEXT
    CHECK (resolution_action IS NULL OR resolution_action IN ('bought', 'not_buying')),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scenario_memory_user_resolution
  ON scenario_memory (user_id, resolution_action, resolved_at DESC);
