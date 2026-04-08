CREATE TABLE IF NOT EXISTS ingest_attempt_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  input_preview TEXT,
  parse_status TEXT,
  review_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_attempt_log_user_created_at
  ON ingest_attempt_log (user_id, created_at DESC);

ALTER TABLE ingest_attempt_log
  DROP CONSTRAINT IF EXISTS ingest_attempt_log_source_check;

ALTER TABLE ingest_attempt_log
  ADD CONSTRAINT ingest_attempt_log_source_check
  CHECK (source IN ('nl', 'receipt'));

ALTER TABLE ingest_attempt_log
  DROP CONSTRAINT IF EXISTS ingest_attempt_log_status_check;

ALTER TABLE ingest_attempt_log
  ADD CONSTRAINT ingest_attempt_log_status_check
  CHECK (status IN ('parsed', 'partial', 'failed'));

ALTER TABLE ingest_attempt_log
  DROP CONSTRAINT IF EXISTS ingest_attempt_log_failure_reason_check;

ALTER TABLE ingest_attempt_log
  ADD CONSTRAINT ingest_attempt_log_failure_reason_check
  CHECK (
    failure_reason IS NULL
    OR failure_reason IN (
      'empty_model_response',
      'invalid_model_json',
      'missing_amount',
      'missing_total',
      'missing_merchant_or_description',
      'missing_required_fields',
      'ai_unavailable'
    )
  );
