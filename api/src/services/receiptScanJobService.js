const crypto = require('crypto');
const db = require('../db');
const BackgroundJob = require('../models/backgroundJob');
const ReceiptScanJob = require('../models/receiptScanJob');
const User = require('../models/user');
const { scanReceiptDocumentInput, scanReceiptInput } = require('./expenseIngestService');
const {
  completeReceiptScan,
  failReceiptScan,
  reserveReceiptScan,
} = require('./receiptScanUsageService');
const {
  deleteReceiptScanInput,
  loadReceiptScanInput,
  storeReceiptScanInput,
} = require('./receiptScanStorage');

function publicJob(job) {
  if (!job) return null;
  return {
    scan_job_id: job.id,
    status: job.status,
    result: job.status === 'succeeded'
      ? { ...(job.result_body || {}), scan_usage: job.usage_snapshot || {} }
      : null,
    error: job.status === 'failed' ? job.error_body || { error: 'Receipt scan failed' } : null,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

async function submitReceiptScanJob({
  user,
  endpoint,
  inputBase64,
  inputHash,
  requestKey,
  mediaType = null,
  fileName = null,
  todayDate,
}) {
  const reservation = await reserveReceiptScan({
    userId: user.id,
    requestKey,
    endpoint,
    inputHash,
  });
  if (reservation.kind === 'cached') {
    return {
      kind: 'cached',
      result: { ...reservation.responseBody, scan_usage: reservation.usage },
    };
  }
  if (reservation.kind === 'in_progress') {
    const existingJob = await ReceiptScanJob.findByRequest(reservation.requestId, user.id);
    if (existingJob) return { kind: 'queued', job: publicJob(existingJob) };
    throw Object.assign(new Error('This receipt scan is still being queued'), {
      status: 409,
      expose: true,
      reason_code: 'receipt_scan_in_progress',
    });
  }
  if (!reservation.requestId) {
    throw Object.assign(new Error('Durable receipt scanning is not enabled'), {
      status: 503,
      expose: true,
      reason_code: 'receipt_scan_jobs_disabled',
    });
  }

  const jobId = crypto.randomUUID();
  let storedInput = null;
  try {
    storedInput = await storeReceiptScanInput({
      userId: user.id,
      jobId,
      endpoint,
      base64: inputBase64,
      mediaType,
      fileName,
    });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const job = await ReceiptScanJob.create({
        id: jobId,
        userId: user.id,
        requestId: reservation.requestId,
        endpoint,
        inputHash,
        mediaType,
        fileName,
        storageBucket: storedInput.bucket,
        storagePath: storedInput.path,
        todayDate,
        usageSnapshot: reservation.usage,
      }, client);
      await BackgroundJob.enqueue({
        jobType: BackgroundJob.JOB_TYPES.receiptScan,
        dedupeKey: jobId,
        payload: { scan_job_id: jobId },
        maxAttempts: 3,
        queryable: client,
      });
      await client.query('COMMIT');
      return { kind: 'queued', job: publicJob(job) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (storedInput) {
      await deleteReceiptScanInput(storedInput).catch(() => {});
    }
    await failReceiptScan({
      requestId: reservation.requestId,
      userId: user.id,
      errorBody: { reason_code: error.reason_code || 'scan_queue_failed' },
    }).catch(() => {});
    throw error;
  }
}

async function runReceiptScanJob(payload = {}) {
  const job = await ReceiptScanJob.findById(payload.scan_job_id);
  if (!job) return { skipped: true };
  if (job.status === 'succeeded') {
    await completeReceiptScan({
      requestId: job.request_id,
      userId: job.user_id,
      responseBody: job.result_body,
      modelUsage: job.model_usage,
    });
    await removeJobInput(job);
    return { resumed: true, succeeded: true };
  }
  if (job.status === 'failed') {
    await failReceiptScan({
      requestId: job.request_id,
      userId: job.user_id,
      errorBody: job.error_body,
      modelUsage: job.model_usage,
    });
    await removeJobInput(job);
    return { resumed: true, failed: true };
  }
  const user = await User.findById(job.user_id);
  if (!user) {
    const errorBody = { error: 'Receipt scan owner is unavailable', reason_code: 'scan_user_missing' };
    await ReceiptScanJob.fail(job.id, errorBody);
    await failReceiptScan({
      requestId: job.request_id,
      userId: job.user_id,
      errorBody,
    });
    return { failed: true };
  }

  await ReceiptScanJob.markProcessing(job.id);
  const inputBase64 = await loadReceiptScanInput({ bucket: job.storage_bucket, path: job.storage_path });
  const result = job.endpoint === 'document'
    ? await scanReceiptDocumentInput({
      user,
      documentBase64: inputBase64,
      fileName: job.file_name,
      todayDate: job.today_date,
    })
    : await scanReceiptInput({
      user,
      imageBase64: inputBase64,
      imageMediaType: job.media_type,
      todayDate: job.today_date,
      allowRetry: true,
    });

  if (result.errorStatus) {
    const errorBody = { ...result.errorBody, status: result.errorStatus };
    await ReceiptScanJob.fail(job.id, errorBody, result.modelUsage);
    await failReceiptScan({
      requestId: job.request_id,
      userId: job.user_id,
      errorBody,
      modelUsage: result.modelUsage,
    });
    await removeJobInput(job);
    return { failed: true, status: result.errorStatus };
  }

  await ReceiptScanJob.succeed(job.id, result.body, result.modelUsage);
  await completeReceiptScan({
    requestId: job.request_id,
    userId: job.user_id,
    responseBody: result.body,
    modelUsage: result.modelUsage,
  });
  await removeJobInput(job);
  return { succeeded: true };
}

async function removeJobInput(job) {
  if (job.input_deleted_at) return;
  try {
    await deleteReceiptScanInput({ bucket: job.storage_bucket, path: job.storage_path });
    await ReceiptScanJob.markInputDeleted(job.id);
  } catch (error) {
    console.warn('[receipt scan] staged input cleanup failed', {
      scan_job_id: job.id,
      message: error?.message || 'unknown_error',
    });
  }
}

async function failDeadReceiptScanJob(payload = {}, error = null) {
  const job = await ReceiptScanJob.findById(payload.scan_job_id);
  if (!job || ['succeeded', 'failed'].includes(job.status)) return;
  const errorBody = {
    error: 'Receipt processing could not be completed',
    reason_code: 'receipt_scan_worker_failed',
  };
  await ReceiptScanJob.fail(job.id, errorBody);
  await failReceiptScan({ requestId: job.request_id, userId: job.user_id, errorBody });
  await removeJobInput(job);
  if (error) {
    console.error('[receipt scan] job exhausted retries', {
      scan_job_id: job.id,
      message: error?.message || 'unknown_error',
    });
  }
}

module.exports = {
  failDeadReceiptScanJob,
  publicJob,
  runReceiptScanJob,
  submitReceiptScanJob,
};
