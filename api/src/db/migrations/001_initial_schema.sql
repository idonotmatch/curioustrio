CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID,  -- FK added after users table; see constraint below
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  household_id UUID REFERENCES households(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE households
  ADD CONSTRAINT fk_households_created_by
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_households_created_by ON households(created_by);

CREATE TABLE household_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  invited_email_hash TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id),
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  merchant TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  date DATE NOT NULL,
  category_id UUID REFERENCES categories(id),
  source TEXT NOT NULL CHECK (source IN ('manual','camera','email')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed')),
  mapkit_stable_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC,
  unit_price NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchant_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  merchant_name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, merchant_name)
);

CREATE TABLE duplicate_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id_a UUID NOT NULL REFERENCES expenses(id),
  expense_id_b UUID NOT NULL REFERENCES expenses(id),
  confidence TEXT NOT NULL CHECK (confidence IN ('exact','fuzzy','uncertain')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','kept_both','dismissed','replaced')),
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  owned_by TEXT NOT NULL CHECK (owned_by IN ('household','user')),
  user_id UUID REFERENCES users(id),
  merchant TEXT NOT NULL,
  expected_amount NUMERIC(10,2) NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  next_expected_date DATE NOT NULL,
  last_matched_expense_id UUID REFERENCES expenses(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_expenses_user_id ON expenses(user_id);
CREATE INDEX idx_expenses_household_id ON expenses(household_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_merchant_mappings_lookup ON merchant_mappings(household_id, merchant_name);
