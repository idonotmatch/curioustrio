ALTER TABLE ingest_attempt_log
  DROP CONSTRAINT IF EXISTS ingest_attempt_log_failure_reason_check;

ALTER TABLE ingest_attempt_log
  ADD CONSTRAINT ingest_attempt_log_failure_reason_check
  CHECK (
    failure_reason IS NULL
    OR failure_reason IN (
      'empty_model_response',
      'invalid_model_json',
      'truncated_model_output',
      'missing_amount',
      'missing_total',
      'missing_merchant_or_description',
      'missing_required_fields',
      'ai_unavailable'
    )
  );
