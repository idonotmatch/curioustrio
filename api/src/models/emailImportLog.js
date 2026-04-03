const db = require('../db');

async function create({ userId, messageId, expenseId, status = 'imported', subject, fromAddress, skipReason }) {
  const result = await db.query(
    `INSERT INTO email_import_log (user_id, message_id, expense_id, status, subject, from_address, skip_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, message_id) DO NOTHING
     RETURNING *`,
    [userId, messageId, expenseId, status, subject || null, fromAddress || null, skipReason || null]
  );
  return result.rows[0] || null;
}

async function findByMessageId(userId, messageId) {
  const result = await db.query(
    `SELECT l.id, l.user_id, l.message_id, l.expense_id, l.status, l.subject, l.from_address, l.skip_reason, l.imported_at,
            e.notes
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     WHERE l.user_id = $1 AND l.message_id = $2`,
    [userId, messageId]
  );
  return result.rows[0] || null;
}

async function listByUser(userId, limit = 100) {
  const result = await db.query(
    `SELECT l.id, l.user_id, l.message_id, l.expense_id, l.status, l.subject, l.from_address, l.skip_reason, l.imported_at,
            e.notes
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     WHERE l.user_id = $1
     ORDER BY l.imported_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

async function summarizeByUser(userId, days = 30) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const countsResult = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE l.status = 'imported') AS imported,
       COUNT(*) FILTER (
         WHERE l.status = 'imported'
           AND e.notes ILIKE '%needs review%'
       ) AS imported_pending_review,
       COUNT(*) FILTER (WHERE l.status = 'skipped') AS skipped,
       COUNT(*) FILTER (WHERE l.status = 'failed') AS failed
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     WHERE l.user_id = $1
       AND l.imported_at >= NOW() - ($2::text || ' days')::interval`,
    [userId, safeDays]
  );

  const reasonsResult = await db.query(
    `SELECT COALESCE(skip_reason, 'unknown') AS reason, COUNT(*)::int AS count
     FROM email_import_log
     WHERE user_id = $1
       AND imported_at >= NOW() - ($2::text || ' days')::interval
       AND status IN ('skipped', 'failed')
     GROUP BY COALESCE(skip_reason, 'unknown')
     ORDER BY count DESC, reason ASC`,
    [userId, safeDays]
  );

  const row = countsResult.rows[0] || {};
  return {
    window_days: safeDays,
    imported: Number(row.imported || 0),
    imported_pending_review: Number(row.imported_pending_review || 0),
    skipped: Number(row.skipped || 0),
    failed: Number(row.failed || 0),
    reasons: reasonsResult.rows.map(r => ({
      reason: r.reason,
      count: Number(r.count || 0),
    })),
  };
}

module.exports = { create, findByMessageId, listByUser, summarizeByUser };
