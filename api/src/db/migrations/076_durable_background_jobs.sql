CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  rerun_requested BOOLEAN NOT NULL DEFAULT FALSE,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT background_jobs_type_check
    CHECK (job_type IN ('projection_refresh', 'post_confirm')),
  CONSTRAINT background_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'dead')),
  CONSTRAINT background_jobs_attempts_check
    CHECK (attempt_count >= 0 AND max_attempts > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_active_dedupe_idx
  ON background_jobs(job_type, dedupe_key)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS background_jobs_claim_idx
  ON background_jobs(status, available_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS background_jobs_stale_idx
  ON background_jobs(locked_at)
  WHERE status = 'running';

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
