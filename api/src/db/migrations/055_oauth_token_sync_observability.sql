ALTER TABLE oauth_tokens
  ADD COLUMN IF NOT EXISTS last_sync_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_source TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_status TEXT;
