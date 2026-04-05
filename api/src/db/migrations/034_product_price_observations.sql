CREATE TABLE IF NOT EXISTS product_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  comparable_key TEXT,
  merchant TEXT NOT NULL,
  observed_price NUMERIC(10,2) NOT NULL CHECK (observed_price > 0),
  observed_unit_price NUMERIC(10,4),
  normalized_total_size_value NUMERIC(10,3),
  normalized_total_size_unit TEXT,
  url TEXT,
  source_type TEXT NOT NULL,
  source_key TEXT,
  metadata JSONB,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (product_id IS NOT NULL OR comparable_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS product_price_observations_product_idx
  ON product_price_observations(product_id, observed_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_price_observations_comparable_idx
  ON product_price_observations(comparable_key, observed_at DESC)
  WHERE comparable_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_price_observations_merchant_idx
  ON product_price_observations(merchant, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS product_price_observations_dedupe_idx
  ON product_price_observations(
    COALESCE(product_id::text, comparable_key),
    merchant,
    observed_at,
    COALESCE(source_key, '')
  );
