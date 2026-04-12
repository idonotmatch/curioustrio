ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS snippet TEXT;
