ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_action TEXT,
  ADD COLUMN IF NOT EXISTS review_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_edit_count INT NOT NULL DEFAULT 0;

ALTER TABLE email_import_log
  DROP CONSTRAINT IF EXISTS email_import_log_review_action_check;

ALTER TABLE email_import_log
  ADD CONSTRAINT email_import_log_review_action_check
  CHECK (review_action IS NULL OR review_action IN ('approved', 'dismissed', 'edited'));

CREATE INDEX IF NOT EXISTS idx_email_import_log_expense_id
  ON email_import_log(expense_id);
