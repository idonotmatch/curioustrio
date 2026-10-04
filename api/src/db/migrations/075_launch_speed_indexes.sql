-- Household membership is consulted by summaries, budgets, trends, and
-- privacy-aware expense scopes on nearly every primary screen.
CREATE INDEX IF NOT EXISTS idx_users_household_members
  ON users (household_id, id)
  WHERE household_id IS NOT NULL;

-- Insight reads check whether each returned card was shown recently. Keep that
-- lookup on a small partial index instead of scanning all interaction events.
CREATE INDEX IF NOT EXISTS idx_insight_events_user_shown_insight_created
  ON insight_events (user_id, insight_id, created_at DESC)
  WHERE event_type = 'shown';

-- Category lists and receipt/category context repeatedly combine global and
-- household-owned categories.
CREATE INDEX IF NOT EXISTS idx_categories_household
  ON categories (household_id, name);
