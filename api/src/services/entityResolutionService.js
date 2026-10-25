const db = require('../db');
const ExpenseReceiptDetail = require('../models/expenseReceiptDetail');
const ExpenseSourceObservation = require('../models/expenseSourceObservation');
const { canonicalMerchantKey, cleanMerchantDisplayName } = require('./merchantIdentity');

const RESOLVER_VERSION = 'identity-v1';

function compact(value, maxLength = 320) {
  const text = `${value || ''}`.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizedKey(value, maxLength = 240) {
  const text = compact(value, maxLength);
  return text
    ? text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, maxLength)
    : null;
}

function normalizedLast4(value) {
  const digits = `${value || ''}`.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function coordinateKey(expense = {}) {
  const existing = compact(expense.mapkit_stable_id, 120);
  if (existing) return existing.toLowerCase();
  const latitude = Number(expense.location_latitude);
  const longitude = Number(expense.location_longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function placeIdentityKey(expense = {}) {
  const providerId = compact(expense.location_provider_id, 240);
  if (providerId) return `provider:${providerId.toLowerCase()}`;
  const coordinates = coordinateKey(expense);
  if (coordinates) return `coordinates:${coordinates}`;
  const place = normalizedKey(expense.place_name, 140);
  const address = normalizedKey(expense.address, 180);
  if (!place && !address) return null;
  return `text:${place || 'unknown'}|${address || 'unknown'}`.slice(0, 320);
}

function isMissingIdentitySchemaError(error) {
  return ['42P01', '42703'].includes(error?.code)
    && /(merchant_entities|merchant_aliases|payment_instruments|place_entities|expense_match_evidence|merchant_entity_id|payment_instrument_id|place_entity_id)/i
      .test(`${error?.message || ''}`);
}

async function resolveMerchantIdentity({ expense, householdId, queryable }) {
  const displayName = cleanMerchantDisplayName(expense.merchant);
  const canonicalKey = canonicalMerchantKey(displayName);
  if (!householdId || !displayName || !canonicalKey) return null;

  const entityResult = await queryable.query(
    `INSERT INTO merchant_entities (household_id, canonical_key, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (household_id, canonical_key) DO UPDATE SET
       updated_at = NOW()
     RETURNING id, canonical_key, display_name`,
    [householdId, canonicalKey, displayName]
  );
  const entity = entityResult.rows[0];
  const aliasKey = normalizedKey(expense.merchant, 240) || canonicalKey;
  await queryable.query(
    `INSERT INTO merchant_aliases (
       household_id, merchant_entity_id, alias_key, alias_name, source, confidence
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (household_id, alias_key) DO UPDATE SET
       occurrence_count = merchant_aliases.occurrence_count + 1,
       updated_at = NOW()`,
    [householdId, entity.id, aliasKey, compact(expense.merchant, 160), 'observed', 1]
  );
  return {
    id: entity.id,
    confidence: 1,
    method: 'canonical_merchant_key',
    evidence: { canonical_key: canonicalKey, display_name: entity.display_name },
  };
}

async function resolvePaymentIdentity({ expense, userId, queryable }) {
  const method = compact(expense.payment_method, 40)?.toLowerCase();
  if (!userId || !['credit', 'debit'].includes(method)) return null;
  const last4 = normalizedLast4(expense.card_last4);
  const label = compact(expense.card_label, 120);
  const labelKey = normalizedKey(label, 140);
  if (!last4 && !labelKey) return null;

  const result = last4
    ? await queryable.query(
      `INSERT INTO payment_instruments (
         user_id, payment_method, card_last4, display_label, label_key
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, payment_method, card_last4)
         WHERE card_last4 IS NOT NULL
       DO UPDATE SET
         display_label = COALESCE(payment_instruments.display_label, EXCLUDED.display_label),
         label_key = COALESCE(payment_instruments.label_key, EXCLUDED.label_key),
         updated_at = NOW()
       RETURNING id, payment_method, card_last4, display_label`,
      [userId, method, last4, label, labelKey]
    )
    : await queryable.query(
      `INSERT INTO payment_instruments (
         user_id, payment_method, card_last4, display_label, label_key
       ) VALUES ($1, $2, NULL, $3, $4)
       ON CONFLICT (user_id, payment_method, label_key)
         WHERE card_last4 IS NULL AND label_key IS NOT NULL
       DO UPDATE SET
         display_label = COALESCE(EXCLUDED.display_label, payment_instruments.display_label),
         updated_at = NOW()
       RETURNING id, payment_method, card_last4, display_label`,
      [userId, method, label, labelKey]
    );
  const entity = result.rows[0];
  return {
    id: entity.id,
    confidence: last4 ? 1 : 0.85,
    method: last4 ? 'payment_method_last4' : 'payment_method_label',
    evidence: {
      payment_method: method,
      card_last4: last4,
      display_label: entity.display_label,
    },
  };
}

async function resolvePlaceIdentity({ expense, userId, queryable }) {
  const identityKey = placeIdentityKey(expense);
  if (!userId || !identityKey) return null;
  const providerId = compact(expense.location_provider_id, 240);
  const provider = providerId ? compact(expense.location_source, 40)?.toLowerCase() || 'mapkit' : null;
  const coordinates = coordinateKey(expense);
  const placeName = compact(expense.place_name, 160);
  const address = compact(expense.address, 320);
  const nameKey = normalizedKey(placeName, 180);
  const result = await queryable.query(
    `INSERT INTO place_entities (
       user_id, identity_key, provider, provider_place_id, coordinate_key,
       place_name, address, name_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, identity_key) DO UPDATE SET
       provider = COALESCE(EXCLUDED.provider, place_entities.provider),
       provider_place_id = COALESCE(EXCLUDED.provider_place_id, place_entities.provider_place_id),
       coordinate_key = COALESCE(EXCLUDED.coordinate_key, place_entities.coordinate_key),
       place_name = COALESCE(EXCLUDED.place_name, place_entities.place_name),
       address = COALESCE(EXCLUDED.address, place_entities.address),
       name_key = COALESCE(EXCLUDED.name_key, place_entities.name_key),
       updated_at = NOW()
     RETURNING id, identity_key`,
    [userId, identityKey, provider, providerId, coordinates, placeName, address, nameKey]
  );
  return {
    id: result.rows[0].id,
    confidence: providerId ? 1 : (coordinates ? 0.95 : 0.75),
    method: providerId ? 'provider_place_id' : (coordinates ? 'coordinate_key' : 'place_name_address'),
    evidence: { identity_key: identityKey, provider, provider_place_id: providerId },
  };
}

async function writeEvidence({ expense, userId, resolutions, queryable }) {
  const domains = ['merchant', 'payment', 'place', 'transaction'];
  for (const domain of domains) {
    const resolution = resolutions[domain];
    if (!resolution) {
      await queryable.query(
        'DELETE FROM expense_match_evidence WHERE expense_id = $1 AND domain = $2',
        [expense.id, domain]
      );
      continue;
    }
    await queryable.query(
      `INSERT INTO expense_match_evidence (
         user_id, expense_id, domain, entity_id, confidence, method, evidence, resolver_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (expense_id, domain) DO UPDATE SET
         entity_id = EXCLUDED.entity_id,
         confidence = EXCLUDED.confidence,
         method = EXCLUDED.method,
         evidence = EXCLUDED.evidence,
         resolver_version = EXCLUDED.resolver_version,
         updated_at = NOW()`,
      [
        userId,
        expense.id,
        domain,
        resolution.id,
        resolution.confidence,
        resolution.method,
        JSON.stringify(resolution.evidence || {}),
        RESOLVER_VERSION,
      ]
    );
  }
}

async function resolveExpenseIdentities({ expense, userId, householdId, queryable = db } = {}) {
  if (!expense?.id || !userId) return { merchant: null, payment: null, place: null };
  const inTransaction = queryable !== db;
  if (inTransaction) await queryable.query('SAVEPOINT expense_identity_compat');
  try {
    const receiptDetails = await ExpenseReceiptDetail.findByExpenseId(expense.id, queryable);
    const observedTransactionIds = await ExpenseSourceObservation.findTransactionIdsForExpense(expense.id, queryable);
    const transactionIds = [...new Set([
      receiptDetails?.transaction_id,
      ...observedTransactionIds,
    ].map((value) => compact(value, 320)).filter(Boolean))];
    const resolutions = {
      merchant: await resolveMerchantIdentity({ expense, householdId, queryable }),
      payment: await resolvePaymentIdentity({ expense, userId, queryable }),
      place: await resolvePlaceIdentity({ expense, userId, queryable }),
      transaction: transactionIds.length ? {
        id: null,
        confidence: 1,
        method: 'external_transaction_id',
        evidence: { identifiers: transactionIds },
      } : null,
    };
    await queryable.query(
      `UPDATE expenses
       SET merchant_entity_id = $2,
           payment_instrument_id = $3,
           place_entity_id = $4
       WHERE id = $1`,
      [expense.id, resolutions.merchant?.id || null, resolutions.payment?.id || null, resolutions.place?.id || null]
    );
    await writeEvidence({ expense, userId, resolutions, queryable });
    if (inTransaction) await queryable.query('RELEASE SAVEPOINT expense_identity_compat');
    return resolutions;
  } catch (error) {
    if (!isMissingIdentitySchemaError(error)) throw error;
    if (inTransaction) {
      await queryable.query('ROLLBACK TO SAVEPOINT expense_identity_compat');
      await queryable.query('RELEASE SAVEPOINT expense_identity_compat');
    }
    return { merchant: null, payment: null, place: null };
  }
}

module.exports = {
  RESOLVER_VERSION,
  isMissingIdentitySchemaError,
  normalizedLast4,
  placeIdentityKey,
  resolveExpenseIdentities,
};
