ALTER TABLE scenario_memory
  ADD COLUMN IF NOT EXISTS watch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS watch_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scenario_memory_user_watch_enabled
  ON scenario_memory (user_id, watch_enabled, expires_at DESC);
