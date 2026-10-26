const db = require('../db');
const { canonicalMerchantKey } = require('../services/merchantIdentity');

function canonicalPair(left, right) {
  return [`${left || ''}`, `${right || ''}`].sort();
}

async function recordExpensePair({
  userId,
  householdId = null,
  domain = 'transaction',
  decision,
  expenseIdA,
  expenseIdB,
  source = 'user_review',
  evidence = {},
  queryable = db,
}) {
  const [left, right] = canonicalPair(expenseIdA, expenseIdB);
  const result = await queryable.query(
    `INSERT INTO match_decisions (
       user_id, household_id, domain, decision, expense_id_a, expense_id_b, source, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (user_id, domain, expense_id_a, expense_id_b)
     WHERE expense_id_a IS NOT NULL AND expense_id_b IS NOT NULL
     DO UPDATE SET
       decision = EXCLUDED.decision,
       source = EXCLUDED.source,
       evidence = EXCLUDED.evidence,
       updated_at = NOW()
     RETURNING *`,
    [userId, householdId, domain, decision, left, right, source, JSON.stringify(evidence || {})]
  );
  return result.rows[0];
}

async function isExpensePairDifferent({ userId, expenseIdA, expenseIdB, queryable = db }) {
  if (!userId || !expenseIdA || !expenseIdB) return false;
  const [left, right] = canonicalPair(expenseIdA, expenseIdB);
  try {
    const result = await queryable.query(
      `SELECT 1 FROM match_decisions
       WHERE user_id = $1
         AND domain = 'transaction'
         AND decision = 'different'
         AND LEAST(expense_id_a, expense_id_b) = $2
         AND GREATEST(expense_id_a, expense_id_b) = $3
       LIMIT 1`,
      [userId, left, right]
    );
    return Boolean(result.rows[0]);
  } catch (error) {
    if (['42P01', '42703'].includes(error?.code)) return false;
    throw error;
  }
}

async function recordObservedRule({
  userId,
  householdId = null,
  domain,
  decision,
  observedKey,
  targetEntityId = null,
  source = 'user_correction',
  evidence = {},
  queryable = db,
}) {
  const result = await queryable.query(
    `INSERT INTO match_decisions (
       user_id, household_id, domain, decision, observed_key, target_entity_id, source, evidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (user_id, domain, observed_key) WHERE observed_key IS NOT NULL
     DO UPDATE SET
       decision = EXCLUDED.decision,
       target_entity_id = EXCLUDED.target_entity_id,
       source = EXCLUDED.source,
       evidence = EXCLUDED.evidence,
       updated_at = NOW()
     RETURNING *`,
    [userId, householdId, domain, decision, observedKey, targetEntityId, source, JSON.stringify(evidence || {})]
  );
  return result.rows[0];
}

function duplicatePatternKey(left = {}, right = {}) {
  const leftMerchantId = left.merchant_entity_id || null;
  const rightMerchantId = right.merchant_entity_id || null;
  const leftMerchantKey = canonicalMerchantKey(left.merchant);
  const rightMerchantKey = canonicalMerchantKey(right.merchant);
  const merchant = leftMerchantId && leftMerchantId === rightMerchantId
    ? `entity:${leftMerchantId}`
    : (leftMerchantKey && leftMerchantKey === rightMerchantKey ? `key:${leftMerchantKey}` : null);
  if (!merchant) return null;
  const sources = [`${left.source || 'unknown'}`, `${right.source || 'unknown'}`].sort().join('+');
  const payment = left.payment_instrument_id && left.payment_instrument_id === right.payment_instrument_id
    ? `payment:${left.payment_instrument_id}`
    : (left.card_last4 && `${left.card_last4}` === `${right.card_last4}` ? `last4:${left.card_last4}` : 'payment:any');
  const place = left.place_entity_id && left.place_entity_id === right.place_entity_id
    ? `place:${left.place_entity_id}`
    : 'place:any';
  return `duplicate-pattern:v1|${merchant}|sources:${sources}|${payment}|${place}`;
}

async function recordDuplicatePatternDecision({ userId, householdId = null, left, right, decision, queryable = db }) {
  const observedKey = duplicatePatternKey(left, right);
  if (!observedKey) return null;
  return recordObservedRule({
    userId,
    householdId,
    domain: 'transaction',
    decision,
    observedKey,
    source: 'duplicate_review_learning',
    evidence: { source_pair: [left.source || null, right.source || null].sort() },
    queryable,
  });
}

async function isDuplicatePatternDifferent({ userId, left, right, queryable = db }) {
  const observedKey = duplicatePatternKey(left, right);
  if (!userId || !observedKey) return false;
  try {
    const result = await queryable.query(
      `SELECT 1 FROM match_decisions
       WHERE user_id = $1 AND domain = 'transaction'
         AND observed_key = $2 AND decision = 'different'
       LIMIT 1`,
      [userId, observedKey]
    );
    return Boolean(result.rows[0]);
  } catch (error) {
    if (['42P01', '42703'].includes(error?.code)) return false;
    throw error;
  }
}

module.exports = {
  canonicalPair,
  duplicatePatternKey,
  isExpensePairDifferent,
  isDuplicatePatternDifferent,
  recordDuplicatePatternDecision,
  recordExpensePair,
  recordObservedRule,
};
