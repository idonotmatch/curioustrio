CREATE TABLE IF NOT EXISTS email_import_feedback (
  expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'edited')),
  review_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_edit_count INT NOT NULL DEFAULT 0,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_import_feedback_reviewed_at
  ON email_import_feedback(reviewed_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'email_import_log'
      AND column_name = 'review_action'
  ) THEN
    INSERT INTO email_import_feedback (
      expense_id,
      review_action,
      review_changed_fields,
      review_edit_count,
      reviewed_at
    )
    SELECT
      expense_id,
      review_action,
      COALESCE(review_changed_fields, '[]'::jsonb),
      COALESCE(review_edit_count, 0),
      COALESCE(reviewed_at, imported_at, NOW())
    FROM email_import_log
    WHERE expense_id IS NOT NULL
      AND (
        review_action IS NOT NULL
        OR COALESCE(review_edit_count, 0) > 0
        OR COALESCE(review_changed_fields, '[]'::jsonb) <> '[]'::jsonb
      )
    ON CONFLICT (expense_id) DO NOTHING;
  END IF;
END $$;
