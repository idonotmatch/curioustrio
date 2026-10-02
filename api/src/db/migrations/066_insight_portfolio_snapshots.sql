CREATE TABLE IF NOT EXISTS insight_portfolio_snapshots (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  insights JSONB NOT NULL DEFAULT '[]'::JSONB,
  source_event JSONB NOT NULL DEFAULT '{}'::JSONB,
  source_fingerprint JSONB NOT NULL DEFAULT '{}'::JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE insight_portfolio_snapshots
  ADD COLUMN IF NOT EXISTS source_fingerprint JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS insight_portfolio_snapshots_generated_idx
  ON insight_portfolio_snapshots(generated_at DESC);
