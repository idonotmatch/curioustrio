ALTER TABLE expense_items
  ADD COLUMN IF NOT EXISTS product_match_confidence TEXT,
  ADD COLUMN IF NOT EXISTS product_match_reason TEXT;

ALTER TABLE expense_items
  DROP CONSTRAINT IF EXISTS expense_items_product_match_confidence_check;

ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_product_match_confidence_check
  CHECK (
    product_match_confidence IS NULL
    OR product_match_confidence IN ('high', 'medium')
  );
