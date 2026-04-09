CREATE TABLE IF NOT EXISTS receipt_line_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  corrected_label TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant, raw_label, corrected_label)
);

CREATE INDEX IF NOT EXISTS idx_receipt_line_corrections_household_merchant
  ON receipt_line_corrections (household_id, merchant, updated_at DESC);
