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

    return {
      counts: countsResult.rows[0] || {},
      reasons: reasonsResult.rows,
    };
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    return null;
  }
}

module.exports = { create, summarizeByUser };
