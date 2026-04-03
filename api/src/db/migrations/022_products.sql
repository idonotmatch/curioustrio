CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  sku TEXT,
  merchant TEXT,
  product_size TEXT,
  pack_size TEXT,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX products_upc_idx ON products(upc) WHERE upc IS NOT NULL;
CREATE INDEX products_sku_merchant_idx ON products(sku, merchant) WHERE sku IS NOT NULL;

ALTER TABLE expense_items ADD COLUMN product_id UUID REFERENCES products(id);
