const db = require('../db');

// Upsert a per-user budget setting (total or per-category).
// categoryId: null for total monthly budget.
async function upsert({ userId, categoryId = null, monthlyLimit }) {
  const result = await db.query(
    `INSERT INTO budget_settings (user_id, category_id, monthly_limit)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT budget_settings_user_category_uq DO UPDATE
       SET monthly_limit = EXCLUDED.monthly_limit, updated_at = NOW()
     RETURNING *`,
    [userId, categoryId, monthlyLimit]
  );
  return result.rows[0];
}

// All budget settings for a single user.
async function findByUser(userId) {
  const result = await db.query(
    'SELECT * FROM budget_settings WHERE user_id = $1 ORDER BY category_id NULLS FIRST',
    [userId]
  );
  return result.rows;
}

// Aggregate budget settings across all members of a household.
// Returns rows shaped like { category_id, monthly_limit } where monthly_limit
// is the SUM of all members' limits for that category (null category_id = total).
async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT bs.category_id, SUM(bs.monthly_limit) AS monthly_limit
     FROM budget_settings bs
     JOIN users u ON bs.user_id = u.id
     WHERE u.household_id = $1
     GROUP BY bs.category_id
     ORDER BY bs.category_id NULLS FIRST`,
    [householdId]
  );
  return result.rows;
}

// Remove a user's category budget (or total budget if categoryId is null).
async function remove({ userId, categoryId = null }) {
  const result = await db.query(
    `DELETE FROM budget_settings
     WHERE user_id = $1
       AND (category_id = $2 OR (category_id IS NULL AND $2 IS NULL))
     RETURNING *`,
    [userId, categoryId]
  );
  return result.rows[0] || null;
}

module.exports = { upsert, findByUser, findByHousehold, remove };
