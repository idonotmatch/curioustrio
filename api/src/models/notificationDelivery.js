const db = require('../db');

async function create({
  userId,
  pushTokenId = null,
  category,
  notificationKey = null,
  expoTicketId = null,
  status = 'accepted',
  errorCode = null,
  errorMessage = null,
  metadata = {},
}) {
  const result = await db.query(
    `INSERT INTO notification_deliveries (
       user_id, push_token_id, category, notification_key, expo_ticket_id,
       status, error_code, error_message, metadata, completed_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,
       CASE WHEN $6 IN ('delivered', 'failed') THEN NOW() ELSE NULL END)
     ON CONFLICT (expo_ticket_id) WHERE expo_ticket_id IS NOT NULL
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      userId,
      pushTokenId,
      category,
      notificationKey,
      expoTicketId,
      status,
      errorCode,
      errorMessage ? `${errorMessage}`.slice(0, 500) : null,
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    `SELECT * FROM notification_deliveries WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function markResult(id, { status, errorCode = null, errorMessage = null } = {}) {
  const result = await db.query(
    `UPDATE notification_deliveries
     SET status = $2,
         error_code = $3,
         error_message = $4,
         completed_at = CASE WHEN $2 IN ('delivered', 'failed') THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, errorCode, errorMessage ? `${errorMessage}`.slice(0, 500) : null]
  );
  return result.rows[0] || null;
}

async function latestAcceptedAt(userId, category) {
  const result = await db.query(
    `SELECT MAX(created_at) AS created_at
     FROM notification_deliveries
     WHERE user_id = $1
       AND category = $2
       AND status IN ('accepted', 'delivered')`,
    [userId, category]
  );
  return result.rows[0]?.created_at || null;
}

async function hasAcceptedKey(userId, category, notificationKey) {
  if (!notificationKey) return false;
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM notification_deliveries
       WHERE user_id = $1
         AND category = $2
         AND notification_key = $3
         AND status IN ('accepted', 'delivered')
     ) AS exists`,
    [userId, category, notificationKey]
  );
  return result.rows[0]?.exists === true;
}

async function pruneOldRows(retentionDays = 90) {
  const days = Math.max(7, Math.min(365, Number(retentionDays) || 90));
  const result = await db.query(
    `DELETE FROM notification_deliveries
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [days]
  );
  return { deleted: result.rowCount || 0, retention_days: days };
}

module.exports = {
  create,
  findById,
  hasAcceptedKey,
  latestAcceptedAt,
  markResult,
  pruneOldRows,
};
