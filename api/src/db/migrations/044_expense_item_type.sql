ALTER TABLE expense_items
  ADD COLUMN IF NOT EXISTS item_type TEXT;

UPDATE expense_items
SET item_type = CASE
  WHEN description ~* '^(discount|coupon|promo(?:tion)?|savings|reward|credit|markdown|sale discount)' THEN 'discount'
  WHEN description ~* '^(tax|hst|gst|pst|vat|tip|gratuity|service charge|service fee|delivery fee|shipping|handling|bag fee|surcharge|platform fee|processing fee)' THEN 'fee'
  WHEN description ~* '^(subtotal|total|order total|amount paid|amount charged|grand total)' THEN 'summary'
  ELSE 'product'
END
WHERE item_type IS NULL;

ALTER TABLE expense_items
  ALTER COLUMN item_type SET DEFAULT 'product';

UPDATE expense_items
SET item_type = 'product'
WHERE item_type IS NULL;

ALTER TABLE expense_items
  ALTER COLUMN item_type SET NOT NULL;

ALTER TABLE expense_items
  DROP CONSTRAINT IF EXISTS expense_items_item_type_check;

ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_item_type_check
  CHECK (item_type IN ('product', 'fee', 'discount', 'summary'));
