ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS location_provider_id TEXT,
  ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS location_status TEXT,
  ADD COLUMN IF NOT EXISTS location_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS location_user_owned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_expenses_location_provider
  ON expenses (location_provider_id)
  WHERE location_provider_id IS NOT NULL;
