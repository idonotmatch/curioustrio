ALTER TABLE expense_items
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS normalized_brand TEXT,
  ADD COLUMN IF NOT EXISTS normalized_size_value NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_size_unit TEXT,
  ADD COLUMN IF NOT EXISTS normalized_pack_size NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS comparable_key TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS normalized_brand TEXT,
  ADD COLUMN IF NOT EXISTS normalized_size_value NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_size_unit TEXT,
  ADD COLUMN IF NOT EXISTS normalized_pack_size NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS comparable_key TEXT;

CREATE INDEX IF NOT EXISTS expense_items_comparable_key_idx ON expense_items(comparable_key) WHERE comparable_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_comparable_key_idx ON products(comparable_key) WHERE comparable_key IS NOT NULL;
