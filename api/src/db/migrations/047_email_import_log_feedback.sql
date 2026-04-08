ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS user_feedback TEXT,
  ADD COLUMN IF NOT EXISTS user_feedback_at TIMESTAMPTZ;

ALTER TABLE email_import_log
  DROP CONSTRAINT IF EXISTS email_import_log_user_feedback_check;

ALTER TABLE email_import_log
  ADD CONSTRAINT email_import_log_user_feedback_check
  CHECK (
    user_feedback IS NULL
    OR user_feedback IN ('should_have_imported', 'didnt_need_review', 'needed_more_review')
  );
