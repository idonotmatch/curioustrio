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

function mergeModelUsage(previous = {}, current = {}) {
  const numericKeys = [
    'model_call_count',
    'model_input_tokens',
    'model_output_tokens',
    'model_cache_creation_input_tokens',
    'model_cache_read_input_tokens',
  ];
  const merged = { ...previous, ...current };
  for (const key of numericKeys) {
    merged[key] = Math.max(0, Number(previous?.[key]) || 0) + Math.max(0, Number(current?.[key]) || 0);
  }
  merged.model_names = [...new Set([
    ...(Array.isArray(previous?.model_names) ? previous.model_names : []),
    ...(Array.isArray(current?.model_names) ? current.model_names : []),
  ])].slice(0, 5);
  return merged;
}

function receiptDateString(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const error = new Error('Receipt scan job has an invalid processing date');
  error.reason_code = 'receipt_scan_invalid_date';
  throw error;
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

  const priorJob = await ReceiptScanJob.findByRequest(reservation.requestId, user.id);
  const reusableJob = priorJob?.status === 'failed' ? priorJob : null;
  const jobId = reusableJob?.id || crypto.randomUUID();
  let storedInput = null;
  try {
    if (reusableJob?.storage_bucket && reusableJob?.storage_path) {
      await deleteReceiptScanInput({
        bucket: reusableJob.storage_bucket,
        path: reusableJob.storage_path,
      }).catch(() => {});
    }
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
      const jobPayload = {
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
      };
      const job = reusableJob
        ? await ReceiptScanJob.requeue(jobPayload, client)
        : await ReceiptScanJob.create(jobPayload, client);
      if (!job) {
        throw Object.assign(new Error('Receipt scan retry could not be queued'), {
          reason_code: 'scan_queue_failed',
        });
      }
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
  const todayDate = receiptDateString(job.today_date);
  const result = job.endpoint === 'document'
    ? await scanReceiptDocumentInput({
      user,
      documentBase64: inputBase64,
      fileName: job.file_name,
      todayDate,
    })
    : await scanReceiptInput({
      user,
      imageBase64: inputBase64,
      imageMediaType: job.media_type,
      todayDate,
      allowRetry: true,
      allowProviderRetry: false,
    });

  if (result.errorStatus) {
    const errorBody = { ...result.errorBody, status: result.errorStatus };
    const modelUsage = mergeModelUsage(job.model_usage, result.modelUsage);
    if (result.errorStatus >= 500 && ['ai_timeout', 'ai_unavailable'].includes(errorBody.reason_code)) {
      await ReceiptScanJob.recordAttemptFailure(job.id, errorBody, modelUsage);
      const transientError = new Error(errorBody.error || 'Receipt AI provider is temporarily unavailable');
      transientError.reason_code = errorBody.reason_code;
      transientError.status = result.errorStatus;
      throw transientError;
    }
    await ReceiptScanJob.fail(job.id, errorBody, modelUsage);
    await failReceiptScan({
      requestId: job.request_id,
      userId: job.user_id,
      errorBody,
      modelUsage,
    });
    await removeJobInput(job);
    return { failed: true, status: result.errorStatus };
  }

  const modelUsage = mergeModelUsage(job.model_usage, result.modelUsage);
  await ReceiptScanJob.succeed(job.id, result.body, modelUsage);
  await completeReceiptScan({
    requestId: job.request_id,
    userId: job.user_id,
    responseBody: result.body,
    modelUsage,
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
  await ReceiptScanJob.fail(job.id, errorBody, job.model_usage || {});
  await failReceiptScan({
    requestId: job.request_id,
    userId: job.user_id,
    errorBody,
    modelUsage: job.model_usage || {},
  });
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
