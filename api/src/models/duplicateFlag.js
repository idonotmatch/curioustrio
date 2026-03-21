const db = require('../db');

async function create({ expenseIdA, expenseIdB, confidence }) {
  const result = await db.query(
    `INSERT INTO duplicate_flags (expense_id_a, expense_id_b, confidence)
     VALUES ($1, $2, $3) RETURNING *`,
    [expenseIdA, expenseIdB, confidence]
  );
  return result.rows[0];
}

async function findByExpenseId(expenseId) {
  const result = await db.query(
    `SELECT * FROM duplicate_flags
     WHERE expense_id_a = $1 OR expense_id_b = $1
     ORDER BY created_at DESC`,
    [expenseId]
  );
  return result.rows;
}

async function updateStatus(id, { status, resolvedBy }) {
  const result = await db.query(
    `UPDATE duplicate_flags SET status = $2, resolved_by = $3 WHERE id = $1 RETURNING *`,
    [id, status, resolvedBy || null]
  );
  return result.rows[0] || null;
}

module.exports = { create, findByExpenseId, updateStatus };
