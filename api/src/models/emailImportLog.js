const db = require('../db');

async function create({ userId, messageId, subject, fromAddress, expenseId, status = 'imported' }) {
  const result = await db.query(
    `INSERT INTO email_import_log (user_id, message_id, subject, from_address, expense_id, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, message_id) DO NOTHING
     RETURNING *`,
    [userId, messageId, subject, fromAddress, expenseId, status]
  );
  return result.rows[0] || null;
}

async function findByMessageId(userId, messageId) {
  const result = await db.query(
    'SELECT * FROM email_import_log WHERE user_id = $1 AND message_id = $2',
    [userId, messageId]
  );
  return result.rows[0] || null;
}

async function listByUser(userId, limit = 100) {
  const result = await db.query(
    'SELECT * FROM email_import_log WHERE user_id = $1 ORDER BY imported_at DESC LIMIT $2',
    [userId, limit]
  );
  return result.rows;
}

module.exports = { create, findByMessageId, listByUser };
