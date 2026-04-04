CREATE TABLE IF NOT EXISTS recurring_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  comparable_key TEXT,
  merchant TEXT,
  item_name TEXT,
  brand TEXT,
  expected_frequency_days INTEGER CHECK (expected_frequency_days IS NULL OR expected_frequency_days > 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, expense_id)
);

CREATE INDEX IF NOT EXISTS recurring_preferences_household_idx
  ON recurring_preferences(household_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS recurring_preferences_product_idx
  ON recurring_preferences(product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recurring_preferences_comparable_idx
  ON recurring_preferences(comparable_key)
  WHERE comparable_key IS NOT NULL;
