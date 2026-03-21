const db = require('../db');

async function create({ name }) {
  const result = await db.query(
    `INSERT INTO households (name) VALUES ($1) RETURNING id, name, created_at`,
    [name]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query(
    `SELECT id, name, created_at FROM households WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByUserId(userId) {
  const result = await db.query(
    `SELECT h.id, h.name, h.created_at
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

module.exports = { create, findById, findByUserId, findMembers };
