const BackgroundJob = require('../models/backgroundJob');
const User = require('../models/user');
const { captureException } = require('./observability');

const DEFAULT_POLL_MS = Math.max(250, Number(process.env.BACKGROUND_JOB_POLL_MS || 1500));
const DEFAULT_LEASE_HEARTBEAT_MS = Math.max(5000, Number(process.env.BACKGROUND_JOB_HEARTBEAT_MS || 30000));
const workerId = BackgroundJob.createWorkerId();

let pollTimer = null;
let drainPromise = null;
let stopping = false;

async function handleProjectionRefresh(payload = {}) {
  const { refreshProjectionNow } = require('./projectionRefreshService');
  const user = await User.findById(payload.user_id);
  if (!user) return { skipped: true, reason: 'user_missing' };
  return refreshProjectionNow({
    user,
    reason: payload.reason,
    scope: payload.scope,
    month: payload.month,
    expense: payload.expense,
    categoryId: payload.category_id,
    merchant: payload.merchant,
    limit: payload.limit,
    metadata: payload.metadata,
  });
}

async function handlePostConfirm(payload = {}) {
  const { runPostConfirmJob } = require('./expenseConfirmService');
  return runPostConfirmJob(payload);
}

async function handleGmailEnrichment(payload = {}) {
  const { runGmailEnrichmentJob } = require('./gmailEnrichmentService');
  return runGmailEnrichmentJob(payload);
}

async function handleGmailSync(payload = {}) {
  const { runGmailSyncJob } = require('./gmailSyncService');
  return runGmailSyncJob(payload);
}

async function handleReceiptScan(payload = {}) {
  const { runReceiptScanJob } = require('./receiptScanJobService');
  return runReceiptScanJob(payload);
}

async function handlePushReceipt(payload = {}) {
  const { reconcilePushReceipt } = require('./pushService');
  return reconcilePushReceipt(payload);
}

async function handlePushDispatch(payload = {}) {
  const { runDeferredPushDispatch } = require('./notificationDispatchService');
  return runDeferredPushDispatch(payload);
}

async function runJob(job) {
  if (job.job_type === BackgroundJob.JOB_TYPES.projectionRefresh) {
    return handleProjectionRefresh(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.postConfirm) {
    return handlePostConfirm(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.gmailEnrichment) {
    return handleGmailEnrichment(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.gmailSync) {
    return handleGmailSync(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.receiptScan) {
    return handleReceiptScan(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.pushReceipt) {
    return handlePushReceipt(job.payload);
  }
  if (job.job_type === BackgroundJob.JOB_TYPES.pushDispatch) {
    return handlePushDispatch(job.payload);
  }
  throw new Error(`No handler registered for background job type: ${job.job_type}`);
}

async function processJob(job) {
  const heartbeat = setInterval(() => {
    BackgroundJob.touch(job.id, workerId).catch((err) => {
      console.error('[background jobs] lease heartbeat failed', {
        job_id: job.id,
        job_type: job.job_type,
        message: err?.message || String(err || 'unknown_error'),
      });
    });
  }, DEFAULT_LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    await runJob(job);
    await BackgroundJob.complete(job.id, workerId);
  } catch (err) {
    const failed = await BackgroundJob.fail(job.id, workerId, err, job.attempt_count);
    if (failed?.status === 'dead' && job.job_type === BackgroundJob.JOB_TYPES.receiptScan) {
      const { failDeadReceiptScanJob } = require('./receiptScanJobService');
      await failDeadReceiptScanJob(job.payload, err).catch((cleanupError) => {
        captureException(cleanupError, {
          component: 'background_job_worker',
          operation: 'finalize_dead_receipt_scan',
          job_id: job.id,
        });
      });
    }
    if (failed?.status === 'dead' && job.job_type === BackgroundJob.JOB_TYPES.gmailSync) {
      const { notifyCronAlert } = require('./cronAlertService');
      await notifyCronAlert({
        job: 'gmail-sync-worker',
        level: 'error',
        message: 'A queued Gmail sync exhausted all retry attempts.',
        metadata: {
          user_id: job.payload?.user_id || null,
          source: job.payload?.source || null,
          background_job_id: job.id,
        },
      }).catch((alertError) => {
        captureException(alertError, {
          component: 'background_job_worker',
          operation: 'alert_dead_gmail_sync',
          job_id: job.id,
        });
      });
    }
    captureException(err, {
      component: 'background_job_worker',
      job_id: job.id,
      job_type: job.job_type,
      attempt_count: job.attempt_count,
      final_attempt: failed?.status === 'dead',
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function drainAvailableJobs({ limit = 5 } = {}) {
  let processed = 0;
  while (!stopping && processed < limit) {
    const job = await BackgroundJob.claimNext(workerId);
    if (!job) break;
    await processJob(job);
    processed += 1;
  }
  return processed;
}

function requestDrain() {
  if (stopping || drainPromise) return drainPromise;
  drainPromise = drainAvailableJobs()
    .catch((err) => {
      captureException(err, { component: 'background_job_worker', operation: 'drain' });
    })
    .finally(() => { drainPromise = null; });
  return drainPromise;
}

async function startBackgroundJobWorker() {
  if (pollTimer || process.env.BACKGROUND_JOBS_DISABLED === 'true') return;
  stopping = false;
  try {
    const recovered = await BackgroundJob.recoverStale();
    if (recovered > 0) console.warn(`[background jobs] recovered ${recovered} stale job(s)`);
  } catch (err) {
    captureException(err, { component: 'background_job_worker', operation: 'recover_stale' });
  }
  pollTimer = setInterval(requestDrain, DEFAULT_POLL_MS);
  pollTimer.unref?.();
  requestDrain();
}

async function stopBackgroundJobWorker({ timeoutMs = 8000 } = {}) {
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (!drainPromise) return;
  await Promise.race([
    drainPromise,
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, timeoutMs));
    }),
  ]);
}

module.exports = {
  drainAvailableJobs,
  handlePostConfirm,
  handleGmailEnrichment,
  handleGmailSync,
  handleReceiptScan,
  handlePushReceipt,
  handlePushDispatch,
  handleProjectionRefresh,
  processJob,
  startBackgroundJobWorker,
  stopBackgroundJobWorker,
};
