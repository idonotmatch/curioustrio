BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS notification_quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notification_quiet_start SMALLINT NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS notification_quiet_end SMALLINT NOT NULL DEFAULT 8;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notification_quiet_start_check;
ALTER TABLE users
  ADD CONSTRAINT users_notification_quiet_start_check
  CHECK (notification_quiet_start BETWEEN 0 AND 23);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_notification_quiet_end_check;
ALTER TABLE users
  ADD CONSTRAINT users_notification_quiet_end_check
  CHECK (notification_quiet_end BETWEEN 0 AND 23);

ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

-- A device token belongs to the account currently signed in on that device.
-- Retain the newest registration if older data attached one token to many users.
DELETE FROM push_tokens older
USING push_tokens newer
WHERE older.token = newer.token
  AND (
    older.updated_at < newer.updated_at
    OR (older.updated_at = newer.updated_at AND older.id < newer.id)
  );

ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_token_key;
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_uq ON push_tokens(token);

ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_fkey;
ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE insight_notifications
  ADD COLUMN IF NOT EXISTS continuity_key TEXT;

CREATE INDEX IF NOT EXISTS insight_notifications_continuity_idx
  ON insight_notifications(user_id, channel, continuity_key, created_at DESC)
  WHERE continuity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token_id UUID REFERENCES push_tokens(id) ON DELETE SET NULL,
  category TEXT NOT NULL
    CHECK (category IN ('gmail_review', 'insight', 'recurring')),
  notification_key TEXT,
  expo_ticket_id TEXT,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'delivered', 'failed')),
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_ticket_uq
  ON notification_deliveries(expo_ticket_id)
  WHERE expo_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_deliveries_user_category_idx
  ON notification_deliveries(user_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_deliveries_pending_receipt_idx
  ON notification_deliveries(status, created_at)
  WHERE status = 'accepted' AND expo_ticket_id IS NOT NULL;

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_type_check;
ALTER TABLE background_jobs
  ADD CONSTRAINT background_jobs_type_check
  CHECK (job_type IN (
    'projection_refresh',
    'post_confirm',
    'gmail_enrichment',
    'gmail_sync',
    'receipt_scan',
    'push_receipt',
    'push_dispatch'
  ));

COMMIT;
