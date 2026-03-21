const db = require('../db');

// Upsert a budget setting (total or category)
// categoryId: null for total household budget
async function upsert({ householdId, categoryId = null, monthlyLimit }) {
  const result = await db.query(
    `INSERT INTO budget_settings (household_id, category_id, monthly_limit)
     VALUES ($1, $2, $3)
     ON CONFLICT (household_id, category_id) DO UPDATE
       SET monthly_limit = EXCLUDED.monthly_limit, updated_at = NOW()
     RETURNING *`,
    [householdId, categoryId, monthlyLimit]
  );
  return result.rows[0];
}

// Returns all budget settings for a household
async function findByHousehold(householdId) {
  const result = await db.query(
    'SELECT * FROM budget_settings WHERE household_id = $1 ORDER BY category_id NULLS FIRST',
    [householdId]
  );
  return result.rows;
}

// Remove a category budget (or total budget if categoryId is null)
async function remove({ householdId, categoryId = null }) {
  const result = await db.query(
    `DELETE FROM budget_settings
     WHERE household_id = $1 AND (category_id = $2 OR (category_id IS NULL AND $2 IS NULL))
     RETURNING *`,
    [householdId, categoryId]
  );
  return result.rows[0] || null;
}

module.exports = { upsert, findByHousehold, remove };
