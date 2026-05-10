CREATE TABLE IF NOT EXISTS insight_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  uncertainty_low NUMERIC(12,2),
  uncertainty_high NUMERIC(12,2),
  confidence_score NUMERIC(5,4),
  confidence_label TEXT,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  feature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  shape JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, insight_id, model_version)
);

CREATE INDEX IF NOT EXISTS insight_forecasts_user_period_idx
  ON insight_forecasts(user_id, period, created_at DESC);

CREATE INDEX IF NOT EXISTS insight_forecasts_valid_until_idx
  ON insight_forecasts(valid_until)
  WHERE valid_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS insight_forecast_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID NOT NULL REFERENCES insight_forecasts(id) ON DELETE CASCADE,
  actual_value NUMERIC(12,2) NOT NULL,
  actual_delta NUMERIC(12,2),
  absolute_error NUMERIC(12,2),
  percent_error NUMERIC(8,4),
  direction_correct BOOLEAN,
  outcome_label TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (forecast_id)
);

CREATE TABLE IF NOT EXISTS forecast_model_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  forecast_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  sample_count INTEGER NOT NULL DEFAULT 0,
  mean_absolute_error NUMERIC(12,2),
  mean_percent_error NUMERIC(8,4),
  bias_amount NUMERIC(12,2),
  direction_accuracy NUMERIC(5,4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS forecast_model_calibration_unique_idx
  ON forecast_model_calibration (
    user_id,
    model_name,
    model_version,
    forecast_type,
    (COALESCE(entity_type, '')),
    (COALESCE(entity_id, ''))
  );
