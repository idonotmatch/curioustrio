const db = require('../db');
const { canonicalMerchantKey } = require('../services/merchantIdentity');

async function findByMerchant(householdId, merchantName) {
  const cleanMerchant = `${merchantName || ''}`.trim();
  const merchantKey = canonicalMerchantKey(cleanMerchant);
  if (!householdId || !merchantKey) return null;

  const result = await db.query(
    `SELECT * FROM merchant_mappings
     WHERE household_id = $1
       AND REGEXP_REPLACE(LOWER(merchant_name), '[^a-z0-9]+', '', 'g') = $2
     ORDER BY hit_count DESC, updated_at DESC
     LIMIT 1`,
    [householdId, merchantKey]
  );
  return result.rows[0] || null;
}

async function upsert({ householdId, merchantName, categoryId }) {
  const cleanMerchant = `${merchantName || ''}`.trim();
  const merchantKey = canonicalMerchantKey(cleanMerchant);
  if (!householdId || !merchantKey || !categoryId) return null;

  await db.query(
    `INSERT INTO merchant_mappings (household_id, merchant_name, category_id, hit_count)
     VALUES ($1, LOWER($2), $3, 1)
     ON CONFLICT (household_id, merchant_name)
     DO UPDATE SET category_id = $3, hit_count = merchant_mappings.hit_count + 1,
     updated_at = NOW()`,
    [householdId, merchantKey, categoryId]
  );
  return true;
}

module.exports = { findByMerchant, upsert };
