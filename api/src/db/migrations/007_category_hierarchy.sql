-- api/src/db/migrations/007_category_hierarchy.sql

BEGIN;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS category_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  leaf_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  suggested_parent_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS category_suggestions_household_idx ON category_suggestions(household_id);
CREATE INDEX IF NOT EXISTS category_suggestions_leaf_id_idx ON category_suggestions(leaf_id);

COMMIT;
