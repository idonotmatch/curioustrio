const db = require('../db');

async function create({ householdId, ownedBy, userId, merchant, expectedAmount, categoryId, frequency, nextExpectedDate }) {
  const result = await db.query(
    `INSERT INTO recurring_expenses
       (household_id, owned_by, user_id, merchant, expected_amount, category_id, frequency, next_expected_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [householdId, ownedBy, userId, merchant, expectedAmount, categoryId, frequency, nextExpectedDate]
  );
  return result.rows[0];
}

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT r.*, c.name as category_name, c.icon as category_icon
     FROM recurring_expenses r
     LEFT JOIN categories c ON r.category_id = c.id
     WHERE r.household_id = $1
     ORDER BY r.next_expected_date ASC`,
    [householdId]
  );
  return result.rows;
}

async function findById(id) {
  const result = await db.query(
    `SELECT r.*, c.name as category_name, c.icon as category_icon
     FROM recurring_expenses r
     LEFT JOIN categories c ON r.category_id = c.id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function remove(id, householdId) {
  const result = await db.query(
    'DELETE FROM recurring_expenses WHERE id = $1 AND household_id = $2 RETURNING *',
    [id, householdId]
  );
  return result.rows[0] || null;
}

async function findDue(householdId, withinDays = 3) {
  const result = await db.query(
    `SELECT * FROM recurring_expenses
     WHERE household_id = $1
       AND next_expected_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
     ORDER BY next_expected_date ASC`,
    [householdId, withinDays]
  );
  return result.rows;
}

module.exports = { create, findById, findByHousehold, remove, findDue };
