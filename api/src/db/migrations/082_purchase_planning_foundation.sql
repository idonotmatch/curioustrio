CREATE TABLE IF NOT EXISTS purchase_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'personal'
    CHECK (scope IN ('personal', 'household')),
  label TEXT NOT NULL,
  estimated_amount NUMERIC(12,2) NOT NULL CHECK (estimated_amount > 0),
  amount_min NUMERIC(12,2),
  amount_max NUMERIC(12,2),
  state TEXT NOT NULL DEFAULT 'considering'
    CHECK (state IN ('considering', 'ready', 'purchased', 'abandoned', 'deferred')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  desired_by DATE,
  recovery_months INTEGER NOT NULL DEFAULT 2 CHECK (recovery_months BETWEEN 1 AND 6),
  minimum_buffer NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_buffer >= 0),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  comparable_key TEXT,
  notes TEXT,
  purchase_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_plans_amount_range_check CHECK (
    (amount_min IS NULL OR amount_min > 0) AND
    (amount_max IS NULL OR amount_max > 0) AND
    (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max)
  )
);

CREATE INDEX IF NOT EXISTS idx_purchase_plans_user_state
  ON purchase_plans (user_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_plans_household_state
  ON purchase_plans (household_id, state, updated_at DESC)
  WHERE household_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_plans_product
  ON purchase_plans (product_id, comparable_key)
  WHERE product_id IS NOT NULL OR comparable_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS planning_funding_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  pool_type TEXT NOT NULL DEFAULT 'savings'
    CHECK (pool_type IN ('savings', 'budget_pool', 'general_reserve', 'other')),
  available_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (available_amount >= 0),
  protected_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (protected_amount >= 0),
  replenishment_required BOOLEAN NOT NULL DEFAULT FALSE,
  replenish_by DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planning_funding_pools_protected_check CHECK (protected_amount <= available_amount)
);

CREATE INDEX IF NOT EXISTS idx_planning_funding_pools_user_active
  ON planning_funding_pools (user_id, active, sort_order, updated_at DESC);

CREATE TABLE IF NOT EXISTS purchase_plan_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES purchase_plans(id) ON DELETE CASCADE,
  pool_id UUID REFERENCES planning_funding_pools(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('current_headroom', 'funding_pool', 'future_recovery', 'installment')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  state TEXT NOT NULL DEFAULT 'suggested'
    CHECK (state IN ('suggested', 'reserved', 'spent', 'released')),
  recovery_month DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT purchase_plan_allocations_pool_check CHECK (
    (source_type = 'funding_pool' AND pool_id IS NOT NULL) OR
    (source_type <> 'funding_pool')
  )
);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_allocations_plan
  ON purchase_plan_allocations (plan_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_plan_allocations_pool_reserved
  ON purchase_plan_allocations (pool_id, state)
  WHERE pool_id IS NOT NULL AND state IN ('reserved', 'spent');

CREATE TABLE IF NOT EXISTS purchase_plan_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES purchase_plans(id) ON DELETE CASCADE,
  evaluated_amount NUMERIC(12,2) NOT NULL,
  observed_price NUMERIC(12,2),
  current_headroom NUMERIC(12,2) NOT NULL DEFAULT 0,
  reserved_elsewhere NUMERIC(12,2) NOT NULL DEFAULT 0,
  available_pool_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  funded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  funding_gap NUMERIC(12,2) NOT NULL DEFAULT 0,
  recovery_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  recommended_strategy TEXT NOT NULL,
  funding_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  material_change TEXT NOT NULL DEFAULT 'initial'
    CHECK (material_change IN ('initial', 'improved', 'worsened', 'unchanged')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_plan_snapshots_plan_created
  ON purchase_plan_snapshots (plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS product_offer_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES purchase_plans(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  comparable_key TEXT,
  merchant TEXT,
  retailer_product_key TEXT,
  url TEXT,
  variant JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_price NUMERIC(12,2) CHECK (target_price IS NULL OR target_price > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_observed_price NUMERIC(12,2),
  last_observed_at TIMESTAMPTZ,
  source_preference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_offer_watches_identity_check CHECK (
    product_id IS NOT NULL OR comparable_key IS NOT NULL OR url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_product_offer_watches_plan_enabled
  ON product_offer_watches (plan_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_offer_watches_identity
  ON product_offer_watches (product_id, comparable_key)
  WHERE enabled = TRUE;

ALTER TABLE product_price_observations
  ADD COLUMN IF NOT EXISTS submitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_watch_id UUID REFERENCES product_offer_watches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_trust TEXT NOT NULL DEFAULT 'user_provided'
    CHECK (source_trust IN ('user_provided', 'receipt', 'email', 'trusted_provider'));

UPDATE product_price_observations
SET source_trust = 'email'
WHERE source_type = 'email';

CREATE INDEX IF NOT EXISTS idx_product_price_observations_user_identity
  ON product_price_observations (submitted_by_user_id, product_id, comparable_key, observed_at DESC);

ALTER TABLE purchase_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_funding_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_plan_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_plan_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_offer_watches ENABLE ROW LEVEL SECURITY;
