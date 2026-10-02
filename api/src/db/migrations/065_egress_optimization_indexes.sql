CREATE INDEX IF NOT EXISTS idx_email_import_log_user_sender_imported_at
  ON email_import_log (user_id, sender_domain, imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_sender_template_imported_at
  ON email_import_log (user_id, sender_domain, subject_pattern, imported_at DESC);
