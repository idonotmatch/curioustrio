ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS sender_domain TEXT;

ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS subject_pattern TEXT;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_sender_domain
  ON email_import_log (user_id, sender_domain, imported_at DESC);
