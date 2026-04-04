const db = require('../db');

async function upsert({ userId, token, platform }) {
  const result = await db.query(
    `INSERT INTO push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO NOTHING
     RETURNING *`,
    [userId, token, platform]
  );
  return result.rows[0] || null;
}

async function findByUser(userId) {
  const result = await db.query(
    'SELECT * FROM push_tokens WHERE user_id = $1',
    [userId]
  );
  return result.rows;
}

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT p.* FROM push_tokens p
     JOIN users u ON p.user_id = u.id
     WHERE u.household_id = $1`,
    [householdId]
  );
  return result.rows;
}

async function findAllUserIds() {
  const result = await db.query(
    `SELECT DISTINCT user_id
     FROM push_tokens`
  );
  return result.rows.map((row) => row.user_id);
}

module.exports = { upsert, findByUser, findByHousehold, findAllUserIds };
