const db = require('../db');

async function upsert({ userId, token, platform }) {
  const result = await db.query(
    `INSERT INTO push_tokens (user_id, token, platform, updated_at, last_seen_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (token) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       updated_at = NOW(),
       last_seen_at = NOW(),
       disabled_at = NULL,
       last_error_code = NULL,
       last_error_at = NULL
     RETURNING *`,
    [userId, token, platform]
  );
  return result.rows[0] || null;
}

async function findByUser(userId) {
  const result = await db.query(
    'SELECT * FROM push_tokens WHERE user_id = $1 AND disabled_at IS NULL',
    [userId]
  );
  return result.rows;
}

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT p.* FROM push_tokens p
     JOIN users u ON p.user_id = u.id
     WHERE u.household_id = $1 AND p.disabled_at IS NULL`,
    [householdId]
  );
  return result.rows;
}

async function findAllUserIds() {
  const result = await db.query(
    `SELECT DISTINCT user_id
     FROM push_tokens
     WHERE disabled_at IS NULL`
  );
  return result.rows.map((row) => row.user_id);
}

async function removeForUserToken(userId, token) {
  const result = await db.query(
    `DELETE FROM push_tokens
     WHERE user_id = $1 AND token = $2
     RETURNING id`,
    [userId, token]
  );
  return result.rowCount > 0;
}

async function disable(id, errorCode = null) {
  if (!id) return null;
  const result = await db.query(
    `UPDATE push_tokens
     SET disabled_at = NOW(),
         last_error_code = $2,
         last_error_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, errorCode ? `${errorCode}`.slice(0, 100) : null]
  );
  return result.rows[0] || null;
}

module.exports = {
  upsert,
  findByUser,
  findByHousehold,
  findAllUserIds,
  removeForUserToken,
  disable,
};
