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

async function findByExpenseId(expenseId) {
  const result = await db.query(
    `SELECT l.*,
            f.reviewed_at,
            f.review_action,
            f.review_changed_fields,
            f.review_edit_count
     FROM email_import_log l
     LEFT JOIN email_import_feedback f ON f.expense_id = l.expense_id
     WHERE l.expense_id = $1
     ORDER BY l.imported_at DESC
     LIMIT 1`,
    [expenseId]
  );
  return result.rows[0] || null;
}

async function recordReviewFeedback(expenseId, { action = null, changedFields = [], incrementEditCount = false } = {}) {
  const cleanFields = [...new Set((Array.isArray(changedFields) ? changedFields : [])
    .map((field) => `${field || ''}`.trim())
    .filter(Boolean))];

  const result = await db.query(
    `INSERT INTO email_import_feedback (
       expense_id, review_action, review_changed_fields, review_edit_count, reviewed_at
     )
     VALUES (
       $1,
       $2,
       $3::jsonb,
       CASE WHEN $4 THEN 1 ELSE 0 END,
       NOW()
     )
     ON CONFLICT (expense_id) DO UPDATE SET
       review_action = COALESCE(EXCLUDED.review_action, email_import_feedback.review_action),
       review_changed_fields = (
         SELECT COALESCE(jsonb_agg(DISTINCT field), '[]'::jsonb)
         FROM (
           SELECT jsonb_array_elements_text(COALESCE(email_import_feedback.review_changed_fields, '[]'::jsonb)) AS field
           UNION ALL
           SELECT jsonb_array_elements_text(EXCLUDED.review_changed_fields) AS field
         ) merged
       ),
       review_edit_count = email_import_feedback.review_edit_count + CASE WHEN $4 THEN 1 ELSE 0 END,
       reviewed_at = NOW()
     RETURNING *`,
    [expenseId, action, JSON.stringify(cleanFields), incrementEditCount]
  );

  return result.rows[0] || null;
}

async function findByMessageId(userId, messageId) {
  const result = await db.query(
    `SELECT l.id, l.user_id, l.message_id, l.expense_id, l.status, l.subject, l.from_address, l.skip_reason, l.imported_at,
            f.reviewed_at, f.review_action, f.review_changed_fields, f.review_edit_count,
            e.notes
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     LEFT JOIN email_import_feedback f ON f.expense_id = l.expense_id
     WHERE l.user_id = $1 AND l.message_id = $2`,
    [userId, messageId]
  );
  return result.rows[0] || null;
}

async function listByUser(userId, limit = 100) {
  const result = await db.query(
    `SELECT l.id, l.user_id, l.message_id, l.expense_id, l.status, l.subject, l.from_address, l.skip_reason, l.imported_at,
            f.reviewed_at, f.review_action, f.review_changed_fields, f.review_edit_count,
            e.notes
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     LEFT JOIN email_import_feedback f ON f.expense_id = l.expense_id
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
       COUNT(*) FILTER (WHERE l.status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE f.review_action = 'approved') AS reviewed_approved,
       COUNT(*) FILTER (WHERE f.review_action = 'dismissed') AS reviewed_dismissed,
       COUNT(*) FILTER (WHERE f.review_edit_count > 0) AS reviewed_edited,
       COUNT(*) FILTER (WHERE f.review_action = 'approved' AND f.review_edit_count = 0) AS approved_without_changes,
       COUNT(*) FILTER (WHERE f.review_action = 'approved' AND f.review_edit_count > 0) AS approved_after_changes,
       MAX(l.imported_at) AS last_imported_at
     FROM email_import_log l
     LEFT JOIN expenses e ON e.id = l.expense_id
     LEFT JOIN email_import_feedback f ON f.expense_id = l.expense_id
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

  const fieldCountsResult = await db.query(
    `SELECT field, COUNT(*)::int AS count
     FROM (
       SELECT jsonb_array_elements_text(COALESCE(review_changed_fields, '[]'::jsonb)) AS field
       FROM email_import_feedback f
       JOIN email_import_log l ON l.expense_id = f.expense_id
       WHERE l.user_id = $1
         AND l.imported_at >= NOW() - ($2::text || ' days')::interval
         AND f.review_edit_count > 0
     ) fields
     GROUP BY field
     ORDER BY count DESC, field ASC`,
    [userId, safeDays]
  );

  const row = countsResult.rows[0] || {};
  return {
    window_days: safeDays,
    imported: Number(row.imported || 0),
    imported_pending_review: Number(row.imported_pending_review || 0),
    skipped: Number(row.skipped || 0),
    failed: Number(row.failed || 0),
    reviewed_approved: Number(row.reviewed_approved || 0),
    reviewed_dismissed: Number(row.reviewed_dismissed || 0),
    reviewed_edited: Number(row.reviewed_edited || 0),
    approved_without_changes: Number(row.approved_without_changes || 0),
    approved_after_changes: Number(row.approved_after_changes || 0),
    last_imported_at: row.last_imported_at || null,
    reasons: reasonsResult.rows.map(r => ({
      reason: r.reason,
      count: Number(r.count || 0),
    })),
    changed_fields: fieldCountsResult.rows.map((row) => ({
      field: row.field,
      count: Number(row.count || 0),
    })),
  };
}

module.exports = { create, findByExpenseId, recordReviewFeedback, findByMessageId, listByUser, summarizeByUser };
