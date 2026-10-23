ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS external_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS email_event_type TEXT,
  ADD COLUMN IF NOT EXISTS related_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_count INTEGER,
  ADD COLUMN IF NOT EXISTS attachment_text_count INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_import_log_event_type_check'
  ) THEN
    ALTER TABLE email_import_log
      ADD CONSTRAINT email_import_log_event_type_check
      CHECK (
        email_event_type IS NULL OR email_event_type IN (
          'purchase_confirmation',
          'charge',
          'refund',
          'shipping_update',
          'cancellation',
          'return_update',
          'unknown'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_import_log_attachment_count_check'
  ) THEN
    ALTER TABLE email_import_log
      ADD CONSTRAINT email_import_log_attachment_count_check
      CHECK (attachment_count IS NULL OR attachment_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_import_log_attachment_text_count_check'
  ) THEN
    ALTER TABLE email_import_log
      ADD CONSTRAINT email_import_log_attachment_text_count_check
      CHECK (attachment_text_count IS NULL OR attachment_text_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_order
  ON email_import_log (user_id, sender_domain, external_order_id, imported_at DESC)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_transaction
  ON email_import_log (user_id, external_transaction_id, imported_at DESC)
  WHERE external_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_thread
  ON email_import_log (user_id, sender_domain, gmail_thread_id, imported_at DESC)
  WHERE gmail_thread_id IS NOT NULL;
