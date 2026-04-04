CREATE TABLE IF NOT EXISTS insight_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'push',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, insight_id, channel)
);

CREATE INDEX IF NOT EXISTS insight_notifications_user_idx
  ON insight_notifications(user_id, channel, created_at DESC);
