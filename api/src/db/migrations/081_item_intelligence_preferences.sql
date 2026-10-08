CREATE TABLE IF NOT EXISTS item_planning_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'watching',
  remind_on DATE,
  target_price NUMERIC(10,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_planning_preferences_state_check
    CHECK (state IN ('watching', 'needed', 'suppressed')),
  CONSTRAINT item_planning_preferences_target_price_check
    CHECK (target_price IS NULL OR target_price > 0),
  CONSTRAINT item_planning_preferences_user_group_unique
    UNIQUE (user_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_item_planning_preferences_user_state
  ON item_planning_preferences (user_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_item_planning_preferences_household_group
  ON item_planning_preferences (household_id, group_key)
  WHERE household_id IS NOT NULL;

ALTER TABLE item_planning_preferences ENABLE ROW LEVEL SECURITY;
