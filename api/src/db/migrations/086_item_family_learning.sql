CREATE TABLE IF NOT EXISTS item_family_learning_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  left_item_key TEXT NOT NULL,
  right_item_key TEXT NOT NULL,
  left_label TEXT NOT NULL,
  right_label TEXT NOT NULL,
  suggested_family_key TEXT NOT NULL,
  suggested_family_name TEXT NOT NULL,
  family_signature TEXT NOT NULL,
  similarity_score NUMERIC(5,4) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_family_learning_candidates_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT item_family_learning_candidates_distinct_items_check
    CHECK (left_item_key <> right_item_key),
  CONSTRAINT item_family_learning_candidates_similarity_check
    CHECK (similarity_score >= 0 AND similarity_score <= 1),
  CONSTRAINT item_family_learning_candidates_unique_pair
    UNIQUE (household_id, left_item_key, right_item_key)
);

CREATE TABLE IF NOT EXISTS item_family_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  family_key TEXT NOT NULL,
  family_name TEXT NOT NULL,
  family_signature TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user_confirmed',
  confidence NUMERIC(5,4) NOT NULL DEFAULT 1,
  candidate_id UUID REFERENCES item_family_learning_candidates(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_family_assignments_source_check
    CHECK (source IN ('user_confirmed', 'curated_alias', 'model_suggested')),
  CONSTRAINT item_family_assignments_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT item_family_assignments_unique_item
    UNIQUE (household_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_item_family_learning_candidates_pending
  ON item_family_learning_candidates(household_id, status, similarity_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_item_family_assignments_lookup
  ON item_family_assignments(household_id, item_key)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_item_family_assignments_family
  ON item_family_assignments(household_id, family_key, updated_at DESC)
  WHERE active = TRUE;

ALTER TABLE item_family_learning_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_family_assignments ENABLE ROW LEVEL SECURITY;
