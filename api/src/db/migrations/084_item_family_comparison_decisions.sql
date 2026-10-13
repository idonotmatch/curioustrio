CREATE TABLE IF NOT EXISTS item_family_comparison_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_key TEXT NOT NULL,
  left_variant_key TEXT NOT NULL,
  right_variant_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_family_comparison_decisions_decision_check
    CHECK (decision IN ('comparable', 'different')),
  CONSTRAINT item_family_comparison_decisions_distinct_variants_check
    CHECK (left_variant_key <> right_variant_key),
  CONSTRAINT item_family_comparison_decisions_unique
    UNIQUE (household_id, family_key, left_variant_key, right_variant_key)
);

CREATE INDEX IF NOT EXISTS idx_item_family_comparison_decisions_lookup
  ON item_family_comparison_decisions(household_id, family_key, updated_at DESC);

ALTER TABLE item_family_comparison_decisions ENABLE ROW LEVEL SECURITY;
