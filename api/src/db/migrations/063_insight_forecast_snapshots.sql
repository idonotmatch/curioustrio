CREATE TABLE IF NOT EXISTS insight_forecast_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  forecast_id UUID REFERENCES insight_forecasts(id) ON DELETE SET NULL,
  insight_id TEXT NOT NULL,
  forecast_type TEXT NOT NULL,
  scope TEXT,
  period TEXT,
  entity_type TEXT,
  entity_id TEXT,
  observed_value NUMERIC(12,2),
  projected_value NUMERIC(12,2),
  projected_delta NUMERIC(12,2),
  baseline_value NUMERIC(12,2),
  confidence_score NUMERIC(5,4),
  confidence_label TEXT,
  feature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  shape JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insight_forecast_snapshots_user_period_idx
  ON insight_forecast_snapshots(user_id, period, created_at DESC);

CREATE INDEX IF NOT EXISTS insight_forecast_snapshots_insight_idx
  ON insight_forecast_snapshots(user_id, insight_id, created_at DESC);

CREATE INDEX IF NOT EXISTS insight_forecast_snapshots_entity_idx
  ON insight_forecast_snapshots(user_id, forecast_type, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS projection_refresh_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  scope TEXT,
  period TEXT,
  expense_id UUID,
  category_id UUID,
  merchant TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  forecast_count INTEGER NOT NULL DEFAULT 0,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS projection_refresh_events_user_created_idx
  ON projection_refresh_events(user_id, created_at DESC);
