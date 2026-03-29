const db = require('../db');

async function create({ name, createdBy }) {
  const result = await db.query(
    `INSERT INTO households (name, created_by) VALUES ($1, $2)
     RETURNING id, name, created_by, created_at`,
    [name, createdBy || null]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query(
    `SELECT id, name, created_by, created_at FROM households WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByUserId(userId) {
  const result = await db.query(
    `SELECT h.id, h.name, h.created_by, h.created_at
     FROM households h
     JOIN users u ON u.household_id = h.id
     WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function findMembers(householdId) {
  const result = await db.query(
    `SELECT id, name, email, created_at FROM users WHERE household_id = $1`,
    [householdId]
  );
  return result.rows;
}

async function updateName(id, name) {
  const result = await db.query(
    `UPDATE households SET name = $1 WHERE id = $2
     RETURNING id, name, created_by, created_at`,
    [name, id]
  );
  return result.rows[0] || null;
}

module.exports = { create, findById, findByUserId, findMembers, updateName };
