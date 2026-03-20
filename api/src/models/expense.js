const db = require('../db');

async function create({ userId, householdId, merchant, amount, date, categoryId, source, status = 'pending', notes, placeName, address, mapkitStableId }) {
  const result = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status, notes, place_name, address, mapkit_stable_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [userId, householdId, merchant, amount, date, categoryId, source, status, notes, placeName, address, mapkitStableId]
  );
  return result.rows[0];
}

async function findByUser(userId, { limit = 50, offset = 0 } = {}) {
  const result = await db.query(
    `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     WHERE e.user_id = $1 AND e.status != 'dismissed'
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

async function updateStatus(id, userId, status) {
  const result = await db.query(
    `UPDATE expenses SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [status, id, userId]
  );
  return result.rows[0] || null;
}

module.exports = { create, findByUser, updateStatus };
