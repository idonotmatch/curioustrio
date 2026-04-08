CREATE TABLE IF NOT EXISTS gmail_sender_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_domain TEXT NOT NULL,
  force_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sender_domain)
);

CREATE INDEX IF NOT EXISTS idx_gmail_sender_preferences_user
  ON gmail_sender_preferences(user_id);
