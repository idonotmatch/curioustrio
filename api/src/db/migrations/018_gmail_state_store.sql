CREATE TABLE gmail_oauth_states (
  token      TEXT        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE INDEX idx_gmail_oauth_states_expires ON gmail_oauth_states(expires_at);
