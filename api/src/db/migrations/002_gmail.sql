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
  subject TEXT,
  from_address TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expense_id UUID REFERENCES expenses(id),
  status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','skipped','failed')),
  UNIQUE(user_id, message_id)
);

CREATE INDEX idx_email_import_log_user ON email_import_log(user_id);
