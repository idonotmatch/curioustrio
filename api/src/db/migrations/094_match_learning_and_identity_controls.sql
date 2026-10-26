BEGIN;

ALTER TABLE merchant_entities
  ADD COLUMN IF NOT EXISTS chain_key TEXT,
  ADD COLUMN IF NOT EXISTS branch_key TEXT,
  ADD COLUMN IF NOT EXISTS seller_context TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES merchant_entities(id) ON DELETE SET NULL;

ALTER TABLE merchant_entities DROP CONSTRAINT IF EXISTS merchant_entities_status_check;
ALTER TABLE merchant_entities
  ADD CONSTRAINT merchant_entities_status_check
  CHECK (status IN ('active', 'merged'));

CREATE INDEX IF NOT EXISTS idx_merchant_entities_chain_branch
  ON merchant_entities (household_id, chain_key, branch_key)
  WHERE status = 'active';

ALTER TABLE payment_instruments
  ADD COLUMN IF NOT EXISTS issuer TEXT,
  ADD COLUMN IF NOT EXISTS network TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS forgotten_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES payment_instruments(id) ON DELETE SET NULL;

ALTER TABLE payment_instruments DROP CONSTRAINT IF EXISTS payment_instruments_status_check;
ALTER TABLE payment_instruments
  ADD CONSTRAINT payment_instruments_status_check
  CHECK (status IN ('active', 'forgotten', 'merged'));

ALTER TABLE payment_instruments DROP CONSTRAINT IF EXISTS payment_instruments_confidence_check;
ALTER TABLE payment_instruments
  ADD CONSTRAINT payment_instruments_confidence_check
  CHECK (confidence >= 0 AND confidence <= 1);

CREATE TABLE IF NOT EXISTS payment_instrument_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_instrument_id UUID NOT NULL REFERENCES payment_instruments(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('credit', 'debit')),
  alias_key TEXT NOT NULL,
  alias_name TEXT,
  card_last4 TEXT,
  source TEXT NOT NULL DEFAULT 'observed'
    CHECK (source IN ('observed', 'backfill', 'user_confirmed')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, payment_method, alias_key, card_last4)
);

CREATE INDEX IF NOT EXISTS idx_payment_aliases_entity
  ON payment_instrument_aliases (payment_instrument_id);

ALTER TABLE place_entities
  ADD COLUMN IF NOT EXISTS chain_key TEXT,
  ADD COLUMN IF NOT EXISTS branch_key TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_by_id UUID REFERENCES place_entities(id) ON DELETE SET NULL;

ALTER TABLE place_entities DROP CONSTRAINT IF EXISTS place_entities_status_check;
ALTER TABLE place_entities
  ADD CONSTRAINT place_entities_status_check
  CHECK (status IN ('active', 'moved', 'merged'));

CREATE TABLE IF NOT EXISTS place_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_entity_id UUID NOT NULL REFERENCES place_entities(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  alias_name TEXT,
  source TEXT NOT NULL DEFAULT 'observed'
    CHECK (source IN ('observed', 'backfill', 'user_confirmed')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, alias_key)
);

CREATE INDEX IF NOT EXISTS idx_place_aliases_entity
  ON place_aliases (place_entity_id);

CREATE TABLE IF NOT EXISTS expense_identity_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('merchant', 'payment', 'place')),
  entity_id UUID,
  decision TEXT NOT NULL DEFAULT 'use_entity'
    CHECK (decision IN ('use_entity', 'keep_separate')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (expense_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_expense_identity_overrides_entity
  ON expense_identity_overrides (user_id, domain, entity_id);

CREATE TABLE IF NOT EXISTS match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('transaction', 'merchant', 'payment', 'place')),
  decision TEXT NOT NULL CHECK (decision IN ('same', 'different')),
  expense_id_a UUID REFERENCES expenses(id) ON DELETE CASCADE,
  expense_id_b UUID REFERENCES expenses(id) ON DELETE CASCADE,
  entity_id_a UUID,
  entity_id_b UUID,
  observed_key TEXT,
  target_entity_id UUID,
  source TEXT NOT NULL DEFAULT 'user_review',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (expense_id_a IS NOT NULL AND expense_id_b IS NOT NULL AND expense_id_a <> expense_id_b)
    OR observed_key IS NOT NULL
    OR (entity_id_a IS NOT NULL AND entity_id_b IS NOT NULL AND entity_id_a <> entity_id_b)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_decisions_expense_pair
  ON match_decisions (user_id, domain, expense_id_a, expense_id_b)
  WHERE expense_id_a IS NOT NULL AND expense_id_b IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_decisions_observed_key
  ON match_decisions (user_id, domain, observed_key)
  WHERE observed_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_match_decisions_entities
  ON match_decisions (user_id, domain, entity_id_a, entity_id_b)
  WHERE entity_id_a IS NOT NULL AND entity_id_b IS NOT NULL;

INSERT INTO payment_instrument_aliases (
  user_id, payment_instrument_id, payment_method, alias_key, alias_name, card_last4,
  source, confidence, occurrence_count
)
SELECT pi.user_id, pi.id, pi.payment_method,
       COALESCE(pi.label_key, CONCAT('last4:', pi.card_last4)),
       pi.display_label, COALESCE(pi.card_last4, ''), 'backfill', pi.confidence,
       GREATEST(1, COUNT(e.id)::int)
FROM payment_instruments pi
LEFT JOIN expenses e ON e.payment_instrument_id = pi.id
GROUP BY pi.id
ON CONFLICT (user_id, payment_method, alias_key, card_last4) DO NOTHING;

INSERT INTO place_aliases (
  user_id, place_entity_id, alias_key, alias_name, source, confidence, occurrence_count
)
SELECT pe.user_id, pe.id, pe.identity_key, pe.place_name, 'backfill',
       CASE WHEN pe.provider_place_id IS NOT NULL THEN 1
            WHEN pe.coordinate_key IS NOT NULL THEN 0.95 ELSE 0.75 END,
       GREATEST(1, COUNT(e.id)::int)
FROM place_entities pe
LEFT JOIN expenses e ON e.place_entity_id = pe.id
GROUP BY pe.id
ON CONFLICT (user_id, alias_key) DO NOTHING;

ALTER TABLE payment_instrument_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_identity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_decisions ENABLE ROW LEVEL SECURITY;

COMMIT;
