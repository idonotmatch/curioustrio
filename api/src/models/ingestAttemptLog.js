const db = require('../db');

function isMissingTableError(err) {
  return err?.code === '42P01' && `${err?.message || ''}`.includes('ingest_attempt_log');
}

async function create({
  userId = null,
  source,
  status,
  failureReason = null,
  inputPreview = null,
  parseStatus = null,
  reviewFields = [],
  metadata = {},
}) {
  try {
    const result = await db.query(
      `INSERT INTO ingest_attempt_log (
         user_id, source, status, failure_reason, input_preview, parse_status, review_fields, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [
        userId,
        source,
        status,
        failureReason,
        inputPreview,
        parseStatus,
        JSON.stringify(Array.isArray(reviewFields) ? reviewFields : []),
        JSON.stringify(metadata || {}),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

async function appendPaymentFeedback(attemptId, userId, {
  originalPaymentMethod = null,
  originalCardLabel = null,
  originalCardLast4 = null,
  finalPaymentMethod = null,
  finalCardLabel = null,
  finalCardLast4 = null,
} = {}) {
  if (!attemptId || !userId) return null;
  const changedFields = [];
  if (`${originalPaymentMethod || ''}` !== `${finalPaymentMethod || ''}`) changedFields.push('payment_method');
  if (`${originalCardLabel || ''}` !== `${finalCardLabel || ''}`) changedFields.push('card_label');
  if (`${originalCardLast4 || ''}` !== `${finalCardLast4 || ''}`) changedFields.push('card_last4');

  try {
    const result = await db.query(
      `UPDATE ingest_attempt_log
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [
        attemptId,
        userId,
        JSON.stringify({
          payment_feedback_recorded: true,
          payment_feedback_changed_fields: changedFields,
          original_payment_method: originalPaymentMethod,
          original_card_label: originalCardLabel,
          original_card_last4: originalCardLast4,
          final_payment_method: finalPaymentMethod,
          final_card_label: finalCardLabel,
          final_card_last4: finalCardLast4,
        }),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

async function markConfirmed(attemptId, userId, { expenseId = null } = {}) {
  if (!attemptId || !userId) return null;
  try {
    const result = await db.query(
      `UPDATE ingest_attempt_log
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [
        attemptId,
        userId,
        JSON.stringify({
          confirm_status: 'confirmed',
          confirmed_expense_id: expenseId,
          confirmed_at: new Date().toISOString(),
        }),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

async function markConfirmFailed(attemptId, userId, { reason = 'confirm_failed', error = null } = {}) {
  if (!attemptId || !userId) return null;
  try {
    const result = await db.query(
      `UPDATE ingest_attempt_log
       SET status = 'failed',
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [
        attemptId,
        userId,
        JSON.stringify({
          confirm_status: 'failed',
          confirm_failure_reason: reason,
          confirm_error: error,
          confirm_failed_at: new Date().toISOString(),
        }),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

async function summarizeByUser(userId, { source = null, days = 30 } = {}) {
  if (!userId) return null;
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const params = [userId, safeDays];
  let sourceClause = '';
  if (source) {
    params.push(source);
    sourceClause = `AND source = $${params.length}`;
  }

  try {
    const countsResult = await db.query(
      `SELECT
         COUNT(*)::int AS attempts,
         COUNT(*) FILTER (WHERE status = 'parsed')::int AS parsed,
         COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'fallback_attempted')::boolean, false))::int AS fallback_attempted,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'fallback_succeeded')::boolean, false))::int AS fallback_succeeded,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'context_retry_attempted')::boolean, false))::int AS context_retry_attempted,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'context_retry_used')::boolean, false))::int AS context_retry_used,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'did_status_improve')::boolean, false))::int AS status_improved,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'did_review_count_improve')::boolean, false))::int AS review_count_improved,
         COUNT(*) FILTER (WHERE COALESCE((metadata->>'retry_was_unnecessary')::boolean, false))::int AS retry_unnecessary
       FROM ingest_attempt_log
       WHERE user_id = $1
         AND created_at >= NOW() - ($2::text || ' days')::interval
         ${sourceClause}`,
      params
    );

    const reasonsResult = await db.query(
      `SELECT COALESCE(failure_reason, 'none') AS reason, COUNT(*)::int AS count
       FROM ingest_attempt_log
       WHERE user_id = $1
         AND created_at >= NOW() - ($2::text || ' days')::interval
         ${sourceClause}
       GROUP BY COALESCE(failure_reason, 'none')
       ORDER BY count DESC, reason ASC`,
      params
    );

    let merchants = [];
    if (!source || source === 'receipt') {
      const merchantParams = source ? params : [userId, safeDays, 'receipt'];
      const receiptSourceClause = source ? sourceClause : `AND source = $3`;
      const merchantsResult = await db.query(
        `WITH attempts AS (
           SELECT
             COALESCE(
               NULLIF(metadata->>'context_merchant_hint', ''),
               NULLIF((regexp_match(COALESCE(metadata->>'raw_text_preview', ''), '"merchant"\\s*:\\s*"([^"]+)"'))[1], '')
             ) AS merchant,
             status,
             failure_reason,
             COALESCE((metadata->>'did_status_improve')::boolean, false) AS did_status_improve,
             COALESCE((metadata->>'fallback_attempted')::boolean, false) AS fallback_attempted,
             COALESCE((metadata->>'fallback_succeeded')::boolean, false) AS fallback_succeeded,
             COALESCE((metadata->>'context_retry_attempted')::boolean, false) AS context_retry_attempted,
             COALESCE((metadata->>'context_retry_used')::boolean, false) AS context_retry_used,
             COALESCE((metadata->>'retry_was_unnecessary')::boolean, false) AS retry_was_unnecessary,
             NULLIF((metadata->>'total_scan_duration_ms')::numeric, 0) AS total_scan_duration_ms,
             NULLIF((metadata->>'initial_parse_duration_ms')::numeric, 0) AS initial_parse_duration_ms,
             NULLIF((metadata->>'context_retry_duration_ms')::numeric, 0) AS context_retry_duration_ms
           FROM ingest_attempt_log
           WHERE user_id = $1
             AND created_at >= NOW() - ($2::text || ' days')::interval
             ${receiptSourceClause}
         )
         SELECT
           COALESCE(merchant, 'Unknown merchant') AS merchant,
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE status = 'parsed')::int AS parsed,
           COUNT(*) FILTER (WHERE status = 'partial')::int AS partial,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE failure_reason = 'truncated_model_output')::int AS truncated,
           COUNT(*) FILTER (WHERE fallback_attempted)::int AS fallback_attempted,
           COUNT(*) FILTER (WHERE fallback_succeeded)::int AS fallback_succeeded,
           COUNT(*) FILTER (WHERE context_retry_attempted)::int AS context_retry_attempted,
           COUNT(*) FILTER (WHERE context_retry_used)::int AS context_retry_used,
           COUNT(*) FILTER (WHERE did_status_improve)::int AS status_improved,
           COUNT(*) FILTER (WHERE retry_was_unnecessary)::int AS retry_unnecessary,
           ROUND(AVG(total_scan_duration_ms))::int AS avg_total_scan_duration_ms,
           ROUND(AVG(initial_parse_duration_ms))::int AS avg_initial_parse_duration_ms,
           ROUND(AVG(context_retry_duration_ms))::int AS avg_context_retry_duration_ms
         FROM attempts
         GROUP BY COALESCE(merchant, 'Unknown merchant')
         ORDER BY attempts DESC, merchant ASC
         LIMIT 12`,
        merchantParams
      );
      merchants = merchantsResult.rows;
    }

    return {
      counts: countsResult.rows[0] || {},
      reasons: reasonsResult.rows,
      merchants,
    };
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

module.exports = { create, appendPaymentFeedback, markConfirmed, markConfirmFailed, summarizeByUser };
