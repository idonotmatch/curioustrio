CREATE TABLE IF NOT EXISTS ai_usage_buckets (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  reserved_units BIGINT NOT NULL DEFAULT 0,
  used_units BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_type, scope_id, feature, metric, period, period_start),
  CHECK (scope_type IN ('account', 'global')),
  CHECK (period IN ('minute', 'day', 'month')),
  CHECK (reserved_units >= 0),
  CHECK (used_units >= 0)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  feature TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  units BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('reserved', 'committed', 'released', 'adjusted')),
  CHECK (units >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_operation
  ON ai_usage_events (operation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created
  ON ai_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_buckets_cleanup
  ON ai_usage_buckets (period_start);

CREATE TABLE IF NOT EXISTS account_feature_entitlements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  plan_code TEXT NOT NULL DEFAULT 'public_default',
  monthly_included_units INTEGER,
  minute_velocity_limit INTEGER,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature),
  CHECK (status IN ('active', 'grace', 'paused')),
  CHECK (monthly_included_units IS NULL OR monthly_included_units > 0),
  CHECK (minute_velocity_limit IS NULL OR minute_velocity_limit > 0)
);

CREATE TABLE IF NOT EXISTS receipt_scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES receipt_scan_requests(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  media_type TEXT,
  file_name TEXT,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  today_date DATE NOT NULL,
  usage_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  result_body JSONB,
  error_body JSONB,
  model_usage JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  input_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE (user_id, request_id),
  UNIQUE (storage_bucket, storage_path),
  CHECK (endpoint IN ('image', 'document')),
  CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  CHECK (char_length(input_hash) = 64)
);

ALTER TABLE receipt_scan_jobs
  ADD COLUMN IF NOT EXISTS usage_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS model_usage JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_receipt_scan_jobs_user_created
  ON receipt_scan_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_scan_jobs_expiry
  ON receipt_scan_jobs (expires_at)
  WHERE result_body IS NOT NULL OR error_body IS NOT NULL;

ALTER TABLE background_jobs
  DROP CONSTRAINT IF EXISTS background_jobs_type_check;

ALTER TABLE background_jobs
  ADD CONSTRAINT background_jobs_type_check
  CHECK (job_type IN ('projection_refresh', 'post_confirm', 'gmail_enrichment', 'gmail_sync', 'receipt_scan'));

ALTER TABLE ai_usage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_feature_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_scan_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_usage_buckets IS
  'Constant-time account and global AI capacity counters. Writes are reserved and reconciled atomically by the API.';

COMMENT ON TABLE ai_usage_events IS
  'Append-only AI usage ledger for cost, reliability, and entitlement auditing. It never stores receipt content.';

COMMENT ON TABLE account_feature_entitlements IS
  'Product-plan entitlement snapshot. Missing rows receive the configured public default; this is not an access allowlist.';

COMMENT ON TABLE receipt_scan_jobs IS
  'Durable receipt extraction jobs. Receipt files live in private short-retention object storage, never in this table.';
