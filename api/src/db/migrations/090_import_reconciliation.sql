ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS field_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_source_check
  CHECK (source IN (
    'manual', 'camera', 'email', 'refund',
    'share', 'forwarded_email', 'financekit', 'bank'
  ));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_review_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_review_source_check
  CHECK (review_source IS NULL OR review_source IN (
    'gmail', 'receipt', 'shared_file', 'financekit', 'bank'
  ));

ALTER TABLE expense_items DROP CONSTRAINT IF EXISTS expense_items_source_type_check;
ALTER TABLE expense_items ADD CONSTRAINT expense_items_source_type_check
  CHECK (
    source_type IS NULL OR source_type IN (
      'email', 'camera', 'manual', 'nl', 'refund',
      'share', 'forwarded_email', 'financekit', 'bank'
    )
  );

CREATE TABLE IF NOT EXISTS expense_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_role TEXT NOT NULL,
  external_record_id TEXT,
  external_transaction_id TEXT,
  observed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_confidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_source_observations_source_check
    CHECK (source_type IN (
      'manual', 'camera', 'email', 'refund',
      'share', 'forwarded_email', 'financekit', 'bank'
    )),
  CONSTRAINT expense_source_observations_role_check
    CHECK (source_role IN ('user', 'detail', 'settlement'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_source_observations_external
  ON expense_source_observations (user_id, source_type, external_record_id)
  WHERE external_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_source_observations_expense
  ON expense_source_observations (expense_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_source_observations_transaction
  ON expense_source_observations (user_id, LOWER(external_transaction_id))
  WHERE external_transaction_id IS NOT NULL;

ALTER TABLE expense_source_observations ENABLE ROW LEVEL SECURITY;

ALTER TABLE expense_merge_events
  ADD COLUMN IF NOT EXISTS transferred_observation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_details_transferred BOOLEAN NOT NULL DEFAULT FALSE;
