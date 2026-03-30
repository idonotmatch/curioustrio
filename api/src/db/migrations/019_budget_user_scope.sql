-- api/src/db/migrations/019_budget_user_scope.sql
-- Rekey budget_settings from household scope to user scope.

ALTER TABLE budget_settings
  ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE budget_settings
  ALTER COLUMN household_id DROP NOT NULL;

ALTER TABLE budget_settings
  DROP CONSTRAINT budget_settings_household_category_uq;

ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_user_category_uq
  UNIQUE NULLS NOT DISTINCT (user_id, category_id);

ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_scope_check
  CHECK (user_id IS NOT NULL OR household_id IS NOT NULL);
