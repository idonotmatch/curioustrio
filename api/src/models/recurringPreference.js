const db = require('../db');

async function upsert({
  userId,
  householdId,
  expenseId,
  productId = null,
  comparableKey = null,
  merchant = null,
  itemName = null,
  brand = null,
  expectedFrequencyDays = null,
  notes = null,
}) {
  const result = await db.query(
    `INSERT INTO recurring_preferences (
       user_id, household_id, expense_id, product_id, comparable_key,
       merchant, item_name, brand, expected_frequency_days, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, expense_id)
     DO UPDATE SET
       product_id = EXCLUDED.product_id,
       comparable_key = EXCLUDED.comparable_key,
       merchant = EXCLUDED.merchant,
       item_name = EXCLUDED.item_name,
       brand = EXCLUDED.brand,
       expected_frequency_days = EXCLUDED.expected_frequency_days,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      householdId,
      expenseId,
      productId,
      comparableKey,
      merchant,
      itemName,
      brand,
      expectedFrequencyDays,
      notes,
    ]
  );
  return result.rows[0] || null;
}

async function findByExpenseId(userId, expenseId) {
  const result = await db.query(
    `SELECT * FROM recurring_preferences WHERE user_id = $1 AND expense_id = $2`,
    [userId, expenseId]
  );
  return result.rows[0] || null;
}

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT * FROM recurring_preferences WHERE household_id = $1 ORDER BY updated_at DESC`,
    [householdId]
  );
  return result.rows;
}

async function remove(id, userId) {
  const result = await db.query(
    `DELETE FROM recurring_preferences WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  upsert,
  findByExpenseId,
  findByHousehold,
  remove,
};
