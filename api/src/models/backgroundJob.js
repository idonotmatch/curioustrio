const crypto = require('crypto');
const db = require('../db');

const JOB_TYPES = Object.freeze({
  projectionRefresh: 'projection_refresh',
  postConfirm: 'post_confirm',
  gmailEnrichment: 'gmail_enrichment',
});

function cleanDelayMs(value) {
  return Math.max(0, Math.min(Number(value) || 0, 24 * 60 * 60 * 1000));
}

async function enqueue({
  jobType,
  dedupeKey,
  payload = {},
  delayMs = 0,
  maxAttempts = 5,
  queryable = db,
} = {}) {
  if (!Object.values(JOB_TYPES).includes(jobType)) throw new Error(`Unsupported background job type: ${jobType}`);
  const cleanKey = `${dedupeKey || ''}`.trim();
  if (!cleanKey) throw new Error('Background job dedupe key is required');

  const result = await queryable.query(
    `INSERT INTO background_jobs (
       job_type, dedupe_key, payload, max_attempts, available_at
     )
     VALUES ($1, $2, $3::jsonb, $4, NOW() + ($5::double precision * INTERVAL '1 millisecond'))
     ON CONFLICT (job_type, dedupe_key) WHERE status IN ('queued', 'running')
     DO UPDATE SET
       payload = EXCLUDED.payload,
       max_attempts = GREATEST(background_jobs.max_attempts, EXCLUDED.max_attempts),
       available_at = EXCLUDED.available_at,
       rerun_requested = background_jobs.rerun_requested OR background_jobs.status = 'running',
       updated_at = NOW()
     RETURNING *`,
    [
      jobType,
      cleanKey,
      JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
      Math.max(1, Math.min(Number(maxAttempts) || 5, 20)),
      cleanDelayMs(delayMs),
    ]
  );
  return result.rows[0] || null;
}

async function claimNext(workerId) {
  const result = await db.query(
    `WITH next_job AS (
       SELECT id
       FROM background_jobs
       WHERE status = 'queued'
         AND available_at <= NOW()
       ORDER BY available_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE background_jobs AS job
     SET status = 'running',
         attempt_count = job.attempt_count + 1,
         locked_at = NOW(),
         locked_by = $1,
         last_error = NULL,
         updated_at = NOW()
     FROM next_job
     WHERE job.id = next_job.id
     RETURNING job.*`,
    [`${workerId || 'worker'}`.slice(0, 200)]
  );
  return result.rows[0] || null;
}

async function touch(id, workerId) {
  await db.query(
    `UPDATE background_jobs
     SET locked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND locked_by = $2`,
    [id, workerId]
  );
}

async function complete(id, workerId) {
  const result = await db.query(
    `UPDATE background_jobs
     SET status = CASE WHEN rerun_requested THEN 'queued' ELSE 'completed' END,
         payload = CASE WHEN rerun_requested THEN payload ELSE '{}'::jsonb END,
         rerun_requested = FALSE,
         locked_at = NULL,
         locked_by = NULL,
         completed_at = CASE WHEN rerun_requested THEN NULL ELSE NOW() END,
         updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND locked_by = $2
     RETURNING *`,
    [id, workerId]
  );
  return result.rows[0] || null;
}

function retryDelayMs(attemptCount) {
  const exponent = Math.max(0, Math.min(Number(attemptCount || 1) - 1, 10));
  return Math.min(15 * 60 * 1000, 1000 * (2 ** exponent));
}

async function fail(id, workerId, error, attemptCount) {
  const message = `${error?.message || error || 'unknown_error'}`.slice(0, 1000);
  const result = await db.query(
    `UPDATE background_jobs
     SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'queued' END,
         available_at = CASE
           WHEN attempt_count >= max_attempts THEN available_at
           ELSE NOW() + ($4::double precision * INTERVAL '1 millisecond')
         END,
         locked_at = NULL,
         locked_by = NULL,
         rerun_requested = FALSE,
         last_error = $3,
         completed_at = CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND locked_by = $2
     RETURNING *`,
    [id, workerId, message, retryDelayMs(attemptCount)]
  );
  return result.rows[0] || null;
}

async function recoverStale({ staleAfterMs = 5 * 60 * 1000 } = {}) {
  const result = await db.query(
    `UPDATE background_jobs
     SET status = 'queued',
         available_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         rerun_requested = FALSE,
         last_error = COALESCE(last_error, 'Worker lease expired before completion'),
         updated_at = NOW()
     WHERE status = 'running'
       AND locked_at < NOW() - ($1::double precision * INTERVAL '1 millisecond')
     RETURNING id`,
    [Math.max(30_000, Number(staleAfterMs) || 5 * 60 * 1000)]
  );
  return result.rows.length;
}

async function pruneFinished({ completedDays = 7, deadDays = 30 } = {}) {
  const result = await db.query(
    `DELETE FROM background_jobs
     WHERE (status = 'completed' AND completed_at < NOW() - ($1::double precision * INTERVAL '1 day'))
        OR (status = 'dead' AND completed_at < NOW() - ($2::double precision * INTERVAL '1 day'))
     RETURNING status`,
    [
      Math.max(1, Number(completedDays) || 7),
      Math.max(1, Number(deadDays) || 30),
    ]
  );
  return result.rows.reduce((counts, row) => ({
    ...counts,
    [row.status]: Number(counts[row.status] || 0) + 1,
  }), {});
}

function createWorkerId() {
  return `${process.pid}:${crypto.randomUUID()}`;
}

module.exports = {
  JOB_TYPES,
  claimNext,
  complete,
  createWorkerId,
  enqueue,
  fail,
  pruneFinished,
  recoverStale,
  retryDelayMs,
  touch,
};
