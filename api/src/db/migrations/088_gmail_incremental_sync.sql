BEGIN;

ALTER TABLE oauth_tokens
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_history_updated_at TIMESTAMPTZ;

ALTER TABLE background_jobs
  DROP CONSTRAINT IF EXISTS background_jobs_type_check;

ALTER TABLE background_jobs
  ADD CONSTRAINT background_jobs_type_check
  CHECK (job_type IN ('projection_refresh', 'post_confirm', 'gmail_enrichment', 'gmail_sync'));

COMMIT;
