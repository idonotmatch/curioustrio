ALTER TABLE expense_items
  ADD COLUMN IF NOT EXISTS observation_key TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS raw_description TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence TEXT;

UPDATE expense_items
SET observation_key = id::text
WHERE observation_key IS NULL;

ALTER TABLE expense_items
  ALTER COLUMN observation_key SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN observation_key SET NOT NULL;

ALTER TABLE expense_items
  DROP CONSTRAINT IF EXISTS expense_items_source_type_check;

ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_source_type_check
  CHECK (
    source_type IS NULL
    OR source_type IN ('email', 'camera', 'manual', 'nl', 'refund')
  );

ALTER TABLE expense_items
  DROP CONSTRAINT IF EXISTS expense_items_extraction_confidence_check;

ALTER TABLE expense_items
  ADD CONSTRAINT expense_items_extraction_confidence_check
  CHECK (
    extraction_confidence IS NULL
    OR extraction_confidence IN ('high', 'medium', 'low')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_items_observation_key
  ON expense_items (expense_id, observation_key);

CREATE INDEX IF NOT EXISTS idx_expense_items_source_confidence
  ON expense_items (source_type, extraction_confidence)
  WHERE source_type IS NOT NULL;
