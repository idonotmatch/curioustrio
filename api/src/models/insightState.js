const db = require('../db');

async function getStateMap(userId, insightIds = []) {
  if (!insightIds.length) return new Map();
  const result = await db.query(
    `SELECT insight_id, status, updated_at
     FROM insight_state
     WHERE user_id = $1
       AND insight_id = ANY($2::text[])`,
    [userId, insightIds]
  );
  return new Map(result.rows.map((row) => [row.insight_id, row]));
}

async function markSeen(userId, insightIds = []) {
  if (!insightIds.length) return [];
  const result = await db.query(
    `INSERT INTO insight_state (user_id, insight_id, status)
     SELECT $1, UNNEST($2::text[]), 'seen'
     ON CONFLICT (user_id, insight_id) DO UPDATE
       SET status = CASE
         WHEN insight_state.status = 'dismissed' THEN insight_state.status
         ELSE 'seen'
       END,
       updated_at = NOW()
     RETURNING *`,
    [userId, insightIds]
  );
  return result.rows;
}

async function dismiss(userId, insightId) {
  const result = await db.query(
    `INSERT INTO insight_state (user_id, insight_id, status)
     VALUES ($1, $2, 'dismissed')
     ON CONFLICT (user_id, insight_id) DO UPDATE
       SET status = 'dismissed',
           updated_at = NOW()
     RETURNING *`,
    [userId, insightId]
  );
  return result.rows[0] || null;
}

module.exports = { getStateMap, markSeen, dismiss };
