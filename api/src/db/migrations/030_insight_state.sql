CREATE TABLE IF NOT EXISTS insight_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('seen', 'dismissed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, insight_id)
);

CREATE INDEX IF NOT EXISTS insight_state_user_status_idx
  ON insight_state(user_id, status, updated_at DESC);
