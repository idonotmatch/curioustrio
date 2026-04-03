CREATE TABLE IF NOT EXISTS category_household_overrides (
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (household_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_category_household_overrides_household
  ON category_household_overrides(household_id);
