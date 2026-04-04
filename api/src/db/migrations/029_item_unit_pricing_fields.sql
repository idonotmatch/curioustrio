ALTER TABLE expense_items
  ADD COLUMN IF NOT EXISTS normalized_quantity NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_total_size_value NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_total_size_unit TEXT,
  ADD COLUMN IF NOT EXISTS estimated_unit_price NUMERIC(10,4);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS normalized_quantity NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_total_size_value NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS normalized_total_size_unit TEXT;
