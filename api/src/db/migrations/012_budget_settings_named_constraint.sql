-- 012_budget_settings_named_constraint.sql
-- Give the budget_settings unique constraint an explicit name so the upsert
-- in budgetSetting.js can reference it via ON CONFLICT ON CONSTRAINT.
-- The original unnamed UNIQUE NULLS NOT DISTINCT (household_id, category_id)
-- created by 003_budgets_refunds_push.sql cannot be targeted by the
-- ON CONFLICT (household_id, category_id) column-list syntax when category_id
-- is NULL, causing an error on every save of the total monthly budget.
ALTER TABLE budget_settings
  RENAME CONSTRAINT budget_settings_household_id_category_id_key
    TO budget_settings_household_category_uq;
