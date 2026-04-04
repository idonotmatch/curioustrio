CREATE TABLE IF NOT EXISTS insight_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('shown', 'tapped', 'dismissed', 'acted')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insight_events_user_created_idx
  ON insight_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS insight_events_insight_idx
  ON insight_events(insight_id, created_at DESC);
