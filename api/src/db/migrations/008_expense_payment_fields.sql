-- Add payment method, card details, private flag, and description to expenses.
-- Also make merchant nullable (description is used when no specific merchant name).

ALTER TABLE expenses
  ALTER COLUMN merchant DROP NOT NULL;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS card_label TEXT,
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
