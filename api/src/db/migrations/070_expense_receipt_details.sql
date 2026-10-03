CREATE TABLE IF NOT EXISTS expense_receipt_details (
  expense_id UUID PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE,
  currency TEXT,
  subtotal NUMERIC(12,2),
  tax NUMERIC(12,2),
  tip NUMERIC(12,2),
  fees NUMERIC(12,2),
  discounts NUMERIC(12,2),
  transaction_id TEXT,
  purchase_time TEXT,
  store_number TEXT,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_receipt_details_transaction
  ON expense_receipt_details (LOWER(transaction_id))
  WHERE transaction_id IS NOT NULL;
