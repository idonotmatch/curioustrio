ALTER TABLE users
  ADD COLUMN IF NOT EXISTS setup_mode TEXT
    CHECK (setup_mode IN ('solo', 'create_household', 'join_household'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_run_primary_choice TEXT
    CHECK (first_run_primary_choice IN ('add_expense', 'set_budget', 'connect_gmail'));

UPDATE users
SET
  setup_mode = CASE
    WHEN household_id IS NOT NULL THEN 'create_household'
    ELSE 'solo'
  END,
  onboarding_complete = true
WHERE setup_mode IS NULL;
