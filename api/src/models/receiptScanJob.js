const db = require('../db');

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

async function markInputDeleted(id) {
  await db.query(
    `UPDATE receipt_scan_jobs SET input_deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

module.exports = {
  create,
  fail,
  findById,
  findByRequest,
  findForUser,
  markInputDeleted,
  markProcessing,
  requeue,
  succeed,
};
