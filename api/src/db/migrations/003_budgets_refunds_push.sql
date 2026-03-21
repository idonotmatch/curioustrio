CREATE TABLE budget_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  category_id UUID REFERENCES categories(id),
  monthly_limit NUMERIC(10,2) NOT NULL CHECK (monthly_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (household_id, category_id)
);

CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token)
);

ALTER TABLE expenses ADD COLUMN linked_expense_id UUID REFERENCES expenses(id);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_source_check
  CHECK (source IN ('manual','camera','email','refund'));

-- Allow recurring expenses without a category
ALTER TABLE recurring_expenses ALTER COLUMN category_id DROP NOT NULL;
