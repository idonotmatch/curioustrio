CREATE TABLE IF NOT EXISTS receipt_scan_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  response_body JSONB,
  error_body JSONB,
  model_call_count INTEGER NOT NULL DEFAULT 0,
  model_input_tokens BIGINT NOT NULL DEFAULT 0,
  model_output_tokens BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE (user_id, request_key),
  CHECK (endpoint IN ('image', 'document')),
  CHECK (status IN ('reserved', 'completed', 'failed')),
  CHECK (attempt_count > 0),
  CHECK (char_length(request_key) BETWEEN 8 AND 128),
  CHECK (char_length(input_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_receipt_scan_requests_user_created
  ON receipt_scan_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_scan_requests_created
  ON receipt_scan_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_scan_requests_active
  ON receipt_scan_requests (user_id, updated_at DESC)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_receipt_scan_requests_expiry
  ON receipt_scan_requests (expires_at)
  WHERE response_body IS NOT NULL OR error_body IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_scan_requests_input_cache
  ON receipt_scan_requests (user_id, input_hash, endpoint, expires_at DESC)
  WHERE status = 'completed' AND response_body IS NOT NULL;

ALTER TABLE receipt_scan_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE receipt_scan_requests IS
  'Durable receipt-scan reservations, short-lived idempotency results, and aggregate AI usage metadata. Images are never stored.';
