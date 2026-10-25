BEGIN;

ALTER TABLE purchase_plans
  ADD COLUMN IF NOT EXISTS selected_strategy TEXT
    CHECK (selected_strategy IS NULL OR selected_strategy IN (
      'current_budget', 'funding_sources', 'recover_over_time', 'wait'
    )),
  ADD COLUMN IF NOT EXISTS decision_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revisit_on DATE;

ALTER TABLE purchase_plan_snapshots
  ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (reserved_amount >= 0);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS purchase_plan_id UUID
    REFERENCES purchase_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_plans_user_revisit
  ON purchase_plans (user_id, revisit_on, updated_at DESC)
  WHERE state IN ('considering', 'deferred') AND revisit_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_purchase_plan
  ON expenses (purchase_plan_id)
  WHERE purchase_plan_id IS NOT NULL;

COMMIT;
