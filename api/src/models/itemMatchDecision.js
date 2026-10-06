const db = require('../db');

function normalizeMerchantKey(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isMissingTableError(err) {
  return err?.code === '42P01' || /item_match_decisions/i.test(`${err?.message || ''}`);
}

async function findForCandidate({
  householdId,
  normalizedName,
  merchant,
  candidateProductId,
}, queryable = db) {
  if (!householdId || !normalizedName || !candidateProductId) return null;
  try {
    const result = await queryable.query(
      `SELECT *
       FROM item_match_decisions
       WHERE household_id = $1
         AND normalized_name = $2
         AND merchant_key = $3
         AND candidate_product_id = $4
       LIMIT 1`,
      [householdId, normalizedName, normalizeMerchantKey(merchant), candidateProductId]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function findConfirmedAlias({
  householdId,
  normalizedName,
  merchant,
}, queryable = db) {
  if (!householdId || !normalizedName) return null;
  try {
    const result = await queryable.query(
      `SELECT
         d.*,
         p.name AS candidate_product_name,
         p.brand AS candidate_product_brand,
         p.merchant AS candidate_product_merchant,
         p.product_size AS candidate_product_size,
         p.pack_size AS candidate_pack_size,
         p.unit AS candidate_product_unit
       FROM item_match_decisions d
       JOIN products p ON p.id = d.candidate_product_id
       WHERE d.household_id = $1
         AND d.normalized_name = $2
         AND d.merchant_key = $3
         AND d.decision = 'same'
       ORDER BY d.updated_at DESC
       LIMIT 1`,
      [householdId, normalizedName, normalizeMerchantKey(merchant)]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function upsert({
  householdId,
  userId,
  expenseItemId,
  observationKey,
  normalizedName,
  merchant,
  candidateProductId,
  decision,
}, queryable = db) {
  const result = await queryable.query(
    `INSERT INTO item_match_decisions (
       household_id, user_id, expense_item_id, observation_key,
       normalized_name, merchant_key, candidate_product_id, decision
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (household_id, normalized_name, merchant_key, candidate_product_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       expense_item_id = EXCLUDED.expense_item_id,
       observation_key = EXCLUDED.observation_key,
       decision = EXCLUDED.decision,
       updated_at = NOW()
     RETURNING *`,
    [
      householdId,
      userId,
      expenseItemId || null,
      observationKey || null,
      normalizedName,
      normalizeMerchantKey(merchant),
      candidateProductId,
      decision,
    ]
  );
  return result.rows[0] || null;
}

module.exports = {
  findConfirmedAlias,
  findForCandidate,
  normalizeMerchantKey,
  upsert,
};
