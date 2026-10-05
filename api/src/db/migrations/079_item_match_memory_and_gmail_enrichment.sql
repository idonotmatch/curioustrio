CREATE TABLE IF NOT EXISTS item_match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_item_id UUID REFERENCES expense_items(id) ON DELETE SET NULL,
  observation_key TEXT,
  normalized_name TEXT NOT NULL,
  merchant_key TEXT NOT NULL DEFAULT '',
  candidate_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_match_decisions_decision_check
    CHECK (decision IN ('same', 'different')),
  CONSTRAINT item_match_decisions_identity_unique
    UNIQUE (household_id, normalized_name, merchant_key, candidate_product_id)
);

CREATE INDEX IF NOT EXISTS item_match_decisions_alias_lookup_idx
  ON item_match_decisions(household_id, normalized_name, merchant_key, decision, updated_at DESC);

CREATE INDEX IF NOT EXISTS item_match_decisions_expense_item_idx
  ON item_match_decisions(expense_item_id)
  WHERE expense_item_id IS NOT NULL;

ALTER TABLE item_match_decisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE background_jobs
  DROP CONSTRAINT IF EXISTS background_jobs_type_check;

ALTER TABLE background_jobs
  ADD CONSTRAINT background_jobs_type_check
  CHECK (job_type IN ('projection_refresh', 'post_confirm', 'gmail_enrichment'));
