const db = require('../db');

async function findByMerchant(householdId, merchantName) {
  const cleanMerchant = `${merchantName || ''}`.trim();
  if (!householdId || !cleanMerchant) return null;

  const result = await db.query(
    `SELECT * FROM merchant_mappings
     WHERE household_id = $1 AND merchant_name = LOWER($2)`,
    [householdId, cleanMerchant]
  );
  return result.rows[0] || null;
}

async function upsert({ householdId, merchantName, categoryId }) {
  const cleanMerchant = `${merchantName || ''}`.trim();
  if (!householdId || !cleanMerchant || !categoryId) return null;

  await db.query(
    `INSERT INTO merchant_mappings (household_id, merchant_name, category_id, hit_count)
     VALUES ($1, LOWER($2), $3, 1)
     ON CONFLICT (household_id, merchant_name)
     DO UPDATE SET category_id = $3, hit_count = merchant_mappings.hit_count + 1,
     updated_at = NOW()`,
    [householdId, cleanMerchant, categoryId]
  );
  return true;
}

module.exports = { findByMerchant, upsert };
