BEGIN;

CREATE TABLE IF NOT EXISTS merchant_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  canonical_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, canonical_key)
);

CREATE TABLE IF NOT EXISTS merchant_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  merchant_entity_id UUID NOT NULL REFERENCES merchant_entities(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  alias_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'observed'
    CHECK (source IN ('observed', 'backfill', 'user_confirmed')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, alias_key)
);

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_entity
  ON merchant_aliases (merchant_entity_id);

CREATE TABLE IF NOT EXISTS payment_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('credit', 'debit')),
  card_last4 TEXT,
  display_label TEXT,
  label_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (card_last4 IS NOT NULL OR label_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_instruments_last4
  ON payment_instruments (user_id, payment_method, card_last4)
  WHERE card_last4 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_instruments_label
  ON payment_instruments (user_id, payment_method, label_key)
  WHERE card_last4 IS NULL AND label_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS place_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  provider TEXT,
  provider_place_id TEXT,
  coordinate_key TEXT,
  place_name TEXT,
  address TEXT,
  name_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, identity_key)
);

CREATE INDEX IF NOT EXISTS idx_place_entities_provider
  ON place_entities (user_id, provider, provider_place_id)
  WHERE provider_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_place_entities_coordinates
  ON place_entities (user_id, coordinate_key)
  WHERE coordinate_key IS NOT NULL;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS merchant_entity_id UUID REFERENCES merchant_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_instrument_id UUID REFERENCES payment_instruments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS place_entity_id UUID REFERENCES place_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_merchant_entity
  ON expenses (merchant_entity_id, date DESC)
  WHERE merchant_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_payment_instrument
  ON expenses (payment_instrument_id, date DESC)
  WHERE payment_instrument_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_place_entity
  ON expenses (place_entity_id, date DESC)
  WHERE place_entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS expense_match_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('merchant', 'payment', 'place', 'transaction')),
  entity_id UUID,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  method TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolver_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (expense_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_expense_match_evidence_entity
  ON expense_match_evidence (user_id, domain, entity_id)
  WHERE entity_id IS NOT NULL;

ALTER TABLE merchant_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_match_evidence ENABLE ROW LEVEL SECURITY;

-- Existing values are intentionally backfilled only with deterministic keys.
-- Fuzzy aliases remain reviewable evidence and never create identity links.
-- Earlier Gmail observations sometimes placed an order ID in the transaction-ID
-- field. The lifecycle ledger has separate fields, so correct those rows before
-- transaction evidence is used for exact duplicate matching.
UPDATE expense_source_observations observation
SET external_transaction_id = log.external_transaction_id,
    updated_at = NOW()
FROM email_import_log log
WHERE observation.user_id = log.user_id
  AND observation.source_type = 'email'
  AND observation.external_record_id = log.message_id
  AND observation.external_transaction_id IS DISTINCT FROM log.external_transaction_id;

WITH merchant_source AS (
  SELECT DISTINCT ON (household_id, canonical_key)
         household_id,
         canonical_key,
         LEFT(BTRIM(merchant), 160) AS display_name
  FROM (
    SELECT household_id,
           merchant,
           created_at,
           REGEXP_REPLACE(
             LOWER(REGEXP_REPLACE(REPLACE(BTRIM(merchant), '&', ' and '),
               '([[:space:][:punct:]]+(incorporated|inc|llc|ltd|limited|corp|corporation|co|company)[[:space:][:punct:]]*)$',
               '', 'i')),
             '[^a-z0-9]+', '', 'g'
           ) AS canonical_key
    FROM expenses
    WHERE household_id IS NOT NULL AND NULLIF(BTRIM(merchant), '') IS NOT NULL
  ) normalized
  WHERE canonical_key <> ''
  ORDER BY household_id, canonical_key, created_at DESC
)
INSERT INTO merchant_entities (household_id, canonical_key, display_name)
SELECT household_id, canonical_key, display_name
FROM merchant_source
ON CONFLICT (household_id, canonical_key) DO NOTHING;

WITH aliases AS (
  SELECT e.household_id,
         me.id AS merchant_entity_id,
         NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(e.merchant)), '[^a-z0-9]+', ' ', 'g')), '') AS alias_key,
         MIN(LEFT(BTRIM(e.merchant), 160)) AS alias_name,
         COUNT(*)::int AS occurrence_count
  FROM expenses e
  JOIN merchant_entities me
    ON me.household_id = e.household_id
   AND me.canonical_key = REGEXP_REPLACE(
     LOWER(REGEXP_REPLACE(REPLACE(BTRIM(e.merchant), '&', ' and '),
       '([[:space:][:punct:]]+(incorporated|inc|llc|ltd|limited|corp|corporation|co|company)[[:space:][:punct:]]*)$',
       '', 'i')),
     '[^a-z0-9]+', '', 'g'
   )
  GROUP BY e.household_id, me.id,
           NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(e.merchant)), '[^a-z0-9]+', ' ', 'g')), '')
)
INSERT INTO merchant_aliases (
  household_id, merchant_entity_id, alias_key, alias_name, source, confidence, occurrence_count
)
SELECT household_id, merchant_entity_id, alias_key, alias_name, 'backfill', 1, occurrence_count
FROM aliases
ON CONFLICT (household_id, alias_key) DO UPDATE SET
  occurrence_count = GREATEST(merchant_aliases.occurrence_count, EXCLUDED.occurrence_count),
  updated_at = NOW();

UPDATE expenses e
SET merchant_entity_id = me.id
FROM merchant_entities me
WHERE e.household_id = me.household_id
  AND me.canonical_key = REGEXP_REPLACE(
    LOWER(REGEXP_REPLACE(REPLACE(BTRIM(e.merchant), '&', ' and '),
      '([[:space:][:punct:]]+(incorporated|inc|llc|ltd|limited|corp|corporation|co|company)[[:space:][:punct:]]*)$',
      '', 'i')),
    '[^a-z0-9]+', '', 'g'
  );

INSERT INTO payment_instruments (user_id, payment_method, card_last4, display_label, label_key)
SELECT DISTINCT ON (user_id, payment_method, normalized_last4)
       user_id,
       payment_method,
       normalized_last4,
       NULLIF(BTRIM(card_label), ''),
       NULLIF(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(card_label, ''))), '[^a-z0-9]+', ' ', 'g'), '')
FROM (
  SELECT e.*,
         RIGHT(REGEXP_REPLACE(COALESCE(card_last4, ''), '[^0-9]+', '', 'g'), 4) AS normalized_last4
  FROM expenses e
  WHERE payment_method IN ('credit', 'debit')
    AND LENGTH(REGEXP_REPLACE(COALESCE(card_last4, ''), '[^0-9]+', '', 'g')) >= 4
) cards
ORDER BY user_id, payment_method, normalized_last4, created_at DESC
ON CONFLICT (user_id, payment_method, card_last4)
  WHERE card_last4 IS NOT NULL
DO NOTHING;

INSERT INTO payment_instruments (user_id, payment_method, card_last4, display_label, label_key)
SELECT DISTINCT ON (user_id, payment_method, label_key)
       user_id, payment_method, NULL, card_label, label_key
FROM (
  SELECT user_id,
         payment_method,
         NULLIF(BTRIM(card_label), '') AS card_label,
         NULLIF(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(card_label, ''))), '[^a-z0-9]+', ' ', 'g'), '') AS label_key,
         created_at
  FROM expenses
  WHERE payment_method IN ('credit', 'debit')
    AND LENGTH(REGEXP_REPLACE(COALESCE(card_last4, ''), '[^0-9]+', '', 'g')) < 4
) labels
WHERE label_key IS NOT NULL
ORDER BY user_id, payment_method, label_key, created_at DESC
ON CONFLICT (user_id, payment_method, label_key)
  WHERE card_last4 IS NULL AND label_key IS NOT NULL
DO NOTHING;

UPDATE expenses e
SET payment_instrument_id = pi.id
FROM payment_instruments pi
WHERE e.user_id = pi.user_id
  AND e.payment_method = pi.payment_method
  AND (
    (pi.card_last4 IS NOT NULL
      AND pi.card_last4 = RIGHT(REGEXP_REPLACE(COALESCE(e.card_last4, ''), '[^0-9]+', '', 'g'), 4))
    OR
    (pi.card_last4 IS NULL
      AND pi.label_key = NULLIF(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(e.card_label, ''))), '[^a-z0-9]+', ' ', 'g'), ''))
  );

WITH place_source AS (
  SELECT e.*,
         CASE
           WHEN NULLIF(BTRIM(location_provider_id), '') IS NOT NULL
             THEN 'provider:' || LOWER(BTRIM(location_provider_id))
           WHEN NULLIF(BTRIM(mapkit_stable_id), '') IS NOT NULL
             THEN 'coordinates:' || LOWER(BTRIM(mapkit_stable_id))
           WHEN location_latitude IS NOT NULL AND location_longitude IS NOT NULL
             THEN 'coordinates:' || ROUND(location_latitude::numeric, 4)::text || ',' || ROUND(location_longitude::numeric, 4)::text
           WHEN NULLIF(BTRIM(place_name), '') IS NOT NULL OR NULLIF(BTRIM(address), '') IS NOT NULL
             THEN LEFT('text:'
               || COALESCE(NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(place_name, ''))), '[^a-z0-9]+', ' ', 'g')), ''), 'unknown')
               || '|'
               || COALESCE(NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(address, ''))), '[^a-z0-9]+', ' ', 'g')), ''), 'unknown'), 320)
           ELSE NULL
         END AS identity_key
  FROM expenses e
)
INSERT INTO place_entities (
  user_id, identity_key, provider, provider_place_id, coordinate_key, place_name, address, name_key
)
SELECT DISTINCT ON (user_id, identity_key)
       user_id,
       identity_key,
       CASE WHEN NULLIF(BTRIM(location_provider_id), '') IS NOT NULL
         THEN COALESCE(NULLIF(LOWER(BTRIM(location_source)), ''), 'mapkit') END,
       NULLIF(BTRIM(location_provider_id), ''),
       COALESCE(
         NULLIF(LOWER(BTRIM(mapkit_stable_id)), ''),
         CASE WHEN location_latitude IS NOT NULL AND location_longitude IS NOT NULL
           THEN ROUND(location_latitude::numeric, 4)::text || ',' || ROUND(location_longitude::numeric, 4)::text END
       ),
       NULLIF(LEFT(BTRIM(place_name), 160), ''),
       NULLIF(LEFT(BTRIM(address), 320), ''),
       NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(place_name, ''))), '[^a-z0-9]+', ' ', 'g')), '')
FROM place_source
WHERE identity_key IS NOT NULL
ORDER BY user_id, identity_key, created_at DESC
ON CONFLICT (user_id, identity_key) DO NOTHING;

WITH keyed_expenses AS (
  SELECT e.id,
         e.user_id,
         CASE
           WHEN NULLIF(BTRIM(location_provider_id), '') IS NOT NULL
             THEN 'provider:' || LOWER(BTRIM(location_provider_id))
           WHEN NULLIF(BTRIM(mapkit_stable_id), '') IS NOT NULL
             THEN 'coordinates:' || LOWER(BTRIM(mapkit_stable_id))
           WHEN location_latitude IS NOT NULL AND location_longitude IS NOT NULL
             THEN 'coordinates:' || ROUND(location_latitude::numeric, 4)::text || ',' || ROUND(location_longitude::numeric, 4)::text
           WHEN NULLIF(BTRIM(place_name), '') IS NOT NULL OR NULLIF(BTRIM(address), '') IS NOT NULL
             THEN LEFT('text:'
               || COALESCE(NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(place_name, ''))), '[^a-z0-9]+', ' ', 'g')), ''), 'unknown')
               || '|'
               || COALESCE(NULLIF(BTRIM(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(address, ''))), '[^a-z0-9]+', ' ', 'g')), ''), 'unknown'), 320)
           ELSE NULL
         END AS identity_key
  FROM expenses e
)
UPDATE expenses e
SET place_entity_id = pe.id
FROM keyed_expenses keyed
JOIN place_entities pe
  ON pe.user_id = keyed.user_id AND pe.identity_key = keyed.identity_key
WHERE e.id = keyed.id;

INSERT INTO expense_match_evidence (
  user_id, expense_id, domain, entity_id, confidence, method, evidence, resolver_version
)
SELECT user_id, id, 'merchant', merchant_entity_id, 1, 'canonical_merchant_key', '{}'::jsonb, 'identity-v1-backfill'
FROM expenses WHERE merchant_entity_id IS NOT NULL
ON CONFLICT (expense_id, domain) DO NOTHING;

INSERT INTO expense_match_evidence (
  user_id, expense_id, domain, entity_id, confidence, method, evidence, resolver_version
)
SELECT user_id, id, 'payment', payment_instrument_id,
       CASE WHEN NULLIF(BTRIM(card_last4), '') IS NOT NULL THEN 1 ELSE 0.85 END,
       CASE WHEN NULLIF(BTRIM(card_last4), '') IS NOT NULL THEN 'payment_method_last4' ELSE 'payment_method_label' END,
       '{}'::jsonb, 'identity-v1-backfill'
FROM expenses WHERE payment_instrument_id IS NOT NULL
ON CONFLICT (expense_id, domain) DO NOTHING;

INSERT INTO expense_match_evidence (
  user_id, expense_id, domain, entity_id, confidence, method, evidence, resolver_version
)
SELECT user_id, id, 'place', place_entity_id,
       CASE
         WHEN NULLIF(BTRIM(location_provider_id), '') IS NOT NULL THEN 1
         WHEN NULLIF(BTRIM(mapkit_stable_id), '') IS NOT NULL OR (location_latitude IS NOT NULL AND location_longitude IS NOT NULL) THEN 0.95
         ELSE 0.75
       END,
       CASE
         WHEN NULLIF(BTRIM(location_provider_id), '') IS NOT NULL THEN 'provider_place_id'
         WHEN NULLIF(BTRIM(mapkit_stable_id), '') IS NOT NULL OR (location_latitude IS NOT NULL AND location_longitude IS NOT NULL) THEN 'coordinate_key'
         ELSE 'place_name_address'
       END,
       '{}'::jsonb, 'identity-v1-backfill'
FROM expenses WHERE place_entity_id IS NOT NULL
ON CONFLICT (expense_id, domain) DO NOTHING;

WITH transaction_identifiers AS (
  SELECT expense_id, transaction_id AS identifier
  FROM expense_receipt_details
  WHERE NULLIF(BTRIM(transaction_id), '') IS NOT NULL
  UNION
  SELECT expense_id, external_transaction_id AS identifier
  FROM expense_source_observations
  WHERE NULLIF(BTRIM(external_transaction_id), '') IS NOT NULL
), grouped AS (
  SELECT expense_id, JSONB_AGG(DISTINCT identifier) AS identifiers
  FROM transaction_identifiers
  GROUP BY expense_id
)
INSERT INTO expense_match_evidence (
  user_id, expense_id, domain, entity_id, confidence, method, evidence, resolver_version
)
SELECT e.user_id, e.id, 'transaction', NULL, 1, 'external_transaction_id',
       JSONB_BUILD_OBJECT('identifiers', grouped.identifiers), 'identity-v1-backfill'
FROM grouped
JOIN expenses e ON e.id = grouped.expense_id
ON CONFLICT (expense_id, domain) DO NOTHING;

COMMIT;
