CREATE TABLE IF NOT EXISTS category_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('confirm', 'edit')),
  merchant_name TEXT,
  description TEXT,
  suggested_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  previous_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  final_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  suggestion_source TEXT,
  suggestion_confidence INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_category_decision_events_user_created
  ON category_decision_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_category_decision_events_expense
  ON category_decision_events(expense_id);
