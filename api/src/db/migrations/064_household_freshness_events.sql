CREATE TABLE IF NOT EXISTS household_freshness_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS household_freshness_events_household_created_idx
  ON household_freshness_events(household_id, created_at DESC);

CREATE INDEX IF NOT EXISTS household_freshness_events_target_user_created_idx
  ON household_freshness_events(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS household_freshness_events_user_created_idx
  ON household_freshness_events(user_id, created_at DESC);

ALTER TABLE household_freshness_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS household_freshness_events_select ON household_freshness_events;
CREATE POLICY household_freshness_events_select
  ON household_freshness_events
  FOR SELECT
  USING (
    user_id IN (SELECT id FROM users WHERE provider_uid = auth.uid()::TEXT)
    OR target_user_id IN (SELECT id FROM users WHERE provider_uid = auth.uid()::TEXT)
    OR household_id IN (SELECT household_id FROM users WHERE provider_uid = auth.uid()::TEXT)
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE household_freshness_events;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN duplicate_object THEN
    NULL;
END $$;
