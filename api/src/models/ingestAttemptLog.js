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

module.exports = { create };
