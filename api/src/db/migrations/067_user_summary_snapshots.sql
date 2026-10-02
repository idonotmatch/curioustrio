CREATE TABLE IF NOT EXISTS user_summary_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  start_day SMALLINT NOT NULL CHECK (start_day BETWEEN 1 AND 28),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period, start_day)
);

CREATE INDEX IF NOT EXISTS user_summary_snapshots_household_idx
  ON user_summary_snapshots(household_id, generated_at DESC);
