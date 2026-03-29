CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  provider TEXT NOT NULL DEFAULT 'google',
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE email_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  message_id TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expense_id UUID REFERENCES expenses(id),
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','skipped','failed')),
  UNIQUE(user_id, message_id)
);

CREATE INDEX idx_email_import_log_user ON email_import_log(user_id);
CREATE INDEX idx_email_import_log_imported_at ON email_import_log(imported_at);

-- Call from a cron job to prune records older than the Gmail lookback window
CREATE OR REPLACE FUNCTION expire_email_import_log() RETURNS void AS $$
  DELETE FROM email_import_log WHERE imported_at < NOW() - INTERVAL '90 days';
$$ LANGUAGE sql;
