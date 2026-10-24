ALTER TABLE email_import_log
  ADD COLUMN IF NOT EXISTS sender_root_domain TEXT,
  ADD COLUMN IF NOT EXISTS message_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS purchase_identity_key TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_match_confidence TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_match_reason TEXT;

UPDATE email_import_log
SET sender_root_domain = CASE
  WHEN sender_domain IS NULL OR sender_domain = 'unknown' THEN 'unknown'
  WHEN sender_domain ~* '\.(co|com|org|net|gov|ac)\.[a-z]{2}$'
    THEN SUBSTRING(sender_domain FROM '([^.]+\.(?:co|com|org|net|gov|ac)\.[^.]+)$')
  ELSE SUBSTRING(sender_domain FROM '([^.]+\.[^.]+)$')
END
WHERE sender_root_domain IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_import_log_lifecycle_match_confidence_check'
  ) THEN
    ALTER TABLE email_import_log
      ADD CONSTRAINT email_import_log_lifecycle_match_confidence_check
      CHECK (
        lifecycle_match_confidence IS NULL
        OR lifecycle_match_confidence IN ('exact', 'high', 'medium', 'none')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_root_order
  ON email_import_log (user_id, sender_root_domain, external_order_id, imported_at DESC)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_message_fingerprint
  ON email_import_log (user_id, message_fingerprint, imported_at DESC)
  WHERE message_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_import_log_user_purchase_identity
  ON email_import_log (user_id, purchase_identity_key, imported_at DESC)
  WHERE purchase_identity_key IS NOT NULL;
