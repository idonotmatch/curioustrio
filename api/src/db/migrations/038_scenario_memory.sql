CREATE TABLE IF NOT EXISTS scenario_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'household')),
  label TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  month TEXT NOT NULL,
  memory_state TEXT NOT NULL DEFAULT 'ephemeral'
    CHECK (memory_state IN ('ephemeral', 'considering', 'suppressed')),
  intent_signal TEXT
    CHECK (intent_signal IN ('considering', 'not_right_now', 'just_exploring')),
  last_affordability_status TEXT,
  last_can_absorb BOOLEAN,
  last_projected_headroom_amount NUMERIC(12,2),
  last_risk_adjusted_headroom_amount NUMERIC(12,2),
  last_recurring_pressure_amount NUMERIC(12,2),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_resurfaced_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenario_memory_user_idx
  ON scenario_memory (user_id, memory_state, expires_at DESC);

CREATE INDEX IF NOT EXISTS scenario_memory_active_idx
  ON scenario_memory (expires_at DESC);
