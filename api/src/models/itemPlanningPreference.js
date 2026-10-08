const db = require('../db');

function isMissingTableError(error) {
  return error?.code === '42P01' || /item_planning_preferences/i.test(`${error?.message || ''}`);
}

async function findByUserAndGroup(userId, groupKey) {
  if (!userId || !groupKey) return null;
  try {
    const result = await db.query(
      `SELECT * FROM item_planning_preferences
       WHERE user_id = $1 AND group_key = $2
       LIMIT 1`,
      [userId, groupKey]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

async function findByUser(userId, { state = null } = {}) {
  if (!userId) return [];
  try {
    const result = await db.query(
      `SELECT * FROM item_planning_preferences
       WHERE user_id = $1
         AND ($2::text IS NULL OR state = $2)
       ORDER BY updated_at DESC`,
      [userId, state]
    );
    return result.rows;
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

async function upsert({
  userId,
  householdId = null,
  groupKey,
  state = 'watching',
  remindOn = null,
  targetPrice = null,
  notes = null,
}) {
  const result = await db.query(
    `INSERT INTO item_planning_preferences (
       user_id, household_id, group_key, state, remind_on, target_price, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, group_key)
     DO UPDATE SET
       household_id = EXCLUDED.household_id,
       state = EXCLUDED.state,
       remind_on = EXCLUDED.remind_on,
       target_price = EXCLUDED.target_price,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [userId, householdId, groupKey, state, remindOn, targetPrice, notes]
  );
  return result.rows[0] || null;
}

module.exports = { findByUserAndGroup, findByUser, upsert, isMissingTableError };
