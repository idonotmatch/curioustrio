const db = require('../db');

function isMissingTable(err) {
  return err?.code === '42P01' || /user_summary_snapshots/i.test(`${err?.message || ''}`);
}

async function find(userId, period, startDay) {
  try {
    const result = await db.query(
      `SELECT payload, generated_at
       FROM user_summary_snapshots
       WHERE user_id = $1 AND period = $2 AND start_day = $3`,
      [userId, period, startDay]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function upsert({ userId, householdId = null, period, startDay, payload }) {
  try {
    const result = await db.query(
      `INSERT INTO user_summary_snapshots (
         user_id, household_id, period, start_day, payload, generated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (user_id, period, start_day)
       DO UPDATE SET household_id = EXCLUDED.household_id,
                     payload = EXCLUDED.payload,
                     generated_at = NOW()
       RETURNING generated_at`,
      [userId, householdId, period, startDay, JSON.stringify(payload || {})]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function invalidateScope({ userId = null, householdId = null, targetUserId = null } = {}) {
  const ids = [...new Set([userId, targetUserId].filter(Boolean))];
  if (!ids.length && !householdId) return;
  try {
    await db.query(
      `DELETE FROM user_summary_snapshots
       WHERE ($1::uuid[] IS NOT NULL AND user_id = ANY($1::uuid[]))
          OR ($2::uuid IS NOT NULL AND household_id = $2)`,
      [ids.length ? ids : null, householdId]
    );
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

module.exports = {
  find,
  invalidateScope,
  upsert,
};
