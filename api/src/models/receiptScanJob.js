const db = require('../db');

function isMissingReceiptJobSchema(error) {
  return error?.code === '42P01'
    && /receipt_scan_jobs|background_jobs/.test(`${error?.message || ''}`);
}

async function create({
  id,
  userId,
  requestId,
  endpoint,
  inputHash,
  mediaType = null,
  fileName = null,
  storageBucket,
  storagePath,
  todayDate,
  usageSnapshot = {},
}, queryable = db) {
  const result = await queryable.query(
    `INSERT INTO receipt_scan_jobs (
       id, user_id, request_id, endpoint, input_hash, media_type, file_name,
       storage_bucket, storage_path, today_date, usage_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING *`,
    [
      id,
      userId,
      requestId,
      endpoint,
      inputHash,
      mediaType,
      fileName,
      storageBucket,
      storagePath,
      todayDate,
      JSON.stringify(usageSnapshot),
    ]
  );
  return result.rows[0] || null;
}

async function requeue({
  id,
  userId,
  endpoint,
  inputHash,
  mediaType = null,
  fileName = null,
  storageBucket,
  storagePath,
  todayDate,
  usageSnapshot = {},
}, queryable = db) {
  const result = await queryable.query(
    `UPDATE receipt_scan_jobs
        SET endpoint = $3,
            input_hash = $4,
            media_type = $5,
            file_name = $6,
            storage_bucket = $7,
            storage_path = $8,
            today_date = $9,
            usage_snapshot = $10::jsonb,
            status = 'queued',
            result_body = NULL,
            error_body = NULL,
            model_usage = '{}'::jsonb,
            started_at = NULL,
            completed_at = NULL,
            input_deleted_at = NULL,
            updated_at = NOW(),
            expires_at = NOW() + INTERVAL '24 hours'
      WHERE id = $1 AND user_id = $2 AND status = 'failed'
      RETURNING *`,
    [
      id,
      userId,
      endpoint,
      inputHash,
      mediaType,
      fileName,
      storageBucket,
      storagePath,
      todayDate,
      JSON.stringify(usageSnapshot),
    ]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(`SELECT * FROM receipt_scan_jobs WHERE id = $1 LIMIT 1`, [id]);
  return result.rows[0] || null;
}

async function findForUser(id, userId) {
  const result = await db.query(
    `SELECT * FROM receipt_scan_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId]
  );
  return result.rows[0] || null;
}

async function findByRequest(requestId, userId) {
  const result = await db.query(
    `SELECT * FROM receipt_scan_jobs
      WHERE request_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [requestId, userId]
  );
  return result.rows[0] || null;
}

async function markProcessing(id) {
  const result = await db.query(
    `UPDATE receipt_scan_jobs
        SET status = 'processing', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'processing')
      RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function succeed(id, resultBody, modelUsage = {}) {
  const result = await db.query(
    `UPDATE receipt_scan_jobs
        SET status = 'succeeded', result_body = $2::jsonb, error_body = NULL,
            model_usage = $3::jsonb,
            completed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, JSON.stringify(resultBody), JSON.stringify(modelUsage)]
  );
  return result.rows[0] || null;
}

async function fail(id, errorBody, modelUsage = {}) {
  const result = await db.query(
    `UPDATE receipt_scan_jobs
        SET status = 'failed', result_body = NULL, error_body = $2::jsonb,
            model_usage = $3::jsonb,
            completed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, JSON.stringify(errorBody), JSON.stringify(modelUsage)]
  );
  return result.rows[0] || null;
}

async function recordAttemptFailure(id, errorBody, modelUsage = {}) {
  const result = await db.query(
    `UPDATE receipt_scan_jobs
        SET error_body = $2::jsonb,
            model_usage = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'processing')
      RETURNING *`,
    [id, JSON.stringify(errorBody), JSON.stringify(modelUsage)]
  );
  return result.rows[0] || null;
}

async function markInputDeleted(id) {
  await db.query(
    `UPDATE receipt_scan_jobs SET input_deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

async function summarizeByUser(userId, { days = 30 } = {}) {
  if (!userId) return null;
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  try {
    const [countsResult, reasonsResult] = await Promise.all([
      db.query(
        `WITH jobs AS (
           SELECT
             job.*,
             worker.status AS worker_status,
             worker.attempt_count
           FROM receipt_scan_jobs AS job
           LEFT JOIN LATERAL (
             SELECT status, attempt_count
             FROM background_jobs
             WHERE job_type = 'receipt_scan'
               AND dedupe_key = job.id::text
             ORDER BY created_at DESC
             LIMIT 1
           ) AS worker ON TRUE
           WHERE job.user_id = $1
             AND job.created_at >= NOW() - ($2::text || ' days')::interval
         )
         SELECT
           COUNT(*)::int AS jobs,
           COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
           COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
           COUNT(*) FILTER (
             WHERE status = 'queued' AND created_at < NOW() - INTERVAL '2 minutes'
           )::int AS stale_queued,
           COUNT(*) FILTER (
             WHERE status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes'
           )::int AS stale_processing,
           COUNT(*) FILTER (WHERE COALESCE(attempt_count, 0) > 1)::int AS retried,
           COUNT(*) FILTER (WHERE worker_status = 'dead')::int AS worker_dead,
           ROUND(AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000)
             FILTER (WHERE started_at IS NOT NULL))::int AS avg_queue_ms,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)) * 1000
           ) FILTER (WHERE started_at IS NOT NULL))::int AS p95_queue_ms,
           ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
             FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL))::int AS avg_processing_ms,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
           ) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL))::int AS p95_processing_ms,
           ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)
             FILTER (WHERE completed_at IS NOT NULL))::int AS avg_end_to_end_ms,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000
           ) FILTER (WHERE completed_at IS NOT NULL))::int AS p95_end_to_end_ms,
           MAX(created_at) AS latest_job_at
         FROM jobs`,
        [userId, safeDays]
      ),
      db.query(
        `SELECT
           COALESCE(NULLIF(error_body->>'reason_code', ''), 'unknown') AS reason,
           COUNT(*)::int AS count
         FROM receipt_scan_jobs
         WHERE user_id = $1
           AND created_at >= NOW() - ($2::text || ' days')::interval
           AND status = 'failed'
         GROUP BY COALESCE(NULLIF(error_body->>'reason_code', ''), 'unknown')
         ORDER BY count DESC, reason ASC`,
        [userId, safeDays]
      ),
    ]);
    return {
      counts: countsResult.rows[0] || {},
      failure_reasons: reasonsResult.rows,
    };
  } catch (error) {
    if (!isMissingReceiptJobSchema(error)) throw error;
    return null;
  }
}

module.exports = {
  create,
  fail,
  findById,
  findByRequest,
  findForUser,
  markInputDeleted,
  markProcessing,
  recordAttemptFailure,
  requeue,
  summarizeByUser,
  succeed,
};
