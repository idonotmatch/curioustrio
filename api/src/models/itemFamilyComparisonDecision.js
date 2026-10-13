const db = require('../db');
const { normalizeVariantPair } = require('../services/itemFamilyService');

function isMissingTableError(err) {
  return err?.code === '42P01';
}

async function findByFamily(householdId, familyKey, queryable = db) {
  if (!householdId || !familyKey) return [];
  try {
    const result = await queryable.query(
      `SELECT *
       FROM item_family_comparison_decisions
       WHERE household_id = $1
         AND family_key = $2
       ORDER BY updated_at DESC`,
      [householdId, familyKey]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function findByHousehold(householdId, queryable = db) {
  if (!householdId) return [];
  try {
    const result = await queryable.query(
      `SELECT *
       FROM item_family_comparison_decisions
       WHERE household_id = $1
       ORDER BY updated_at DESC`,
      [householdId]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function upsert({
  householdId,
  userId,
  familyKey,
  leftVariantKey,
  rightVariantKey,
  decision,
}, queryable = db) {
  const [leftKey, rightKey] = normalizeVariantPair(leftVariantKey, rightVariantKey);
  const result = await queryable.query(
    `INSERT INTO item_family_comparison_decisions (
       household_id, user_id, family_key, left_variant_key, right_variant_key, decision
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (household_id, family_key, left_variant_key, right_variant_key)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       decision = EXCLUDED.decision,
       updated_at = NOW()
     RETURNING *`,
    [householdId, userId, familyKey, leftKey, rightKey, decision]
  );
  return result.rows[0] || null;
}

module.exports = { findByFamily, findByHousehold, upsert };
