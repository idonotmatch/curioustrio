jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: {
    projectionRefresh: 'projection_refresh',
    postConfirm: 'post_confirm',
    gmailEnrichment: 'gmail_enrichment',
    gmailSync: 'gmail_sync',
    receiptScan: 'receipt_scan',
  },
  claimNext: jest.fn(),
  complete: jest.fn().mockResolvedValue({ status: 'completed' }),
  createWorkerId: jest.fn(() => 'worker-1'),
  fail: jest.fn().mockResolvedValue({ status: 'queued' }),
  recoverStale: jest.fn().mockResolvedValue(0),
  touch: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/projectionRefreshService', () => ({
  refreshProjectionNow: jest.fn().mockResolvedValue({ forecast_count: 1 }),
}));
jest.mock('../../src/services/expenseConfirmService', () => ({
  runPostConfirmJob: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/gmailEnrichmentService', () => ({
  runGmailEnrichmentJob: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/gmailSyncService', () => ({
  runGmailSyncJob: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/receiptScanJobService', () => ({
  runReceiptScanJob: jest.fn().mockResolvedValue({ succeeded: true }),
  failDeadReceiptScanJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/observability', () => ({ captureException: jest.fn() }));

const BackgroundJob = require('../../src/models/backgroundJob');
const User = require('../../src/models/user');
const { refreshProjectionNow } = require('../../src/services/projectionRefreshService');
const { runPostConfirmJob } = require('../../src/services/expenseConfirmService');
const { runGmailEnrichmentJob } = require('../../src/services/gmailEnrichmentService');
const { runGmailSyncJob } = require('../../src/services/gmailSyncService');
const { runReceiptScanJob, failDeadReceiptScanJob } = require('../../src/services/receiptScanJobService');
const { captureException } = require('../../src/services/observability');
const { processJob } = require('../../src/services/backgroundJobWorker');

describe('background job worker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rebuilds projection jobs from the current user record', async () => {
    const user = { id: 'user-1', household_id: null };
    User.findById.mockResolvedValueOnce(user);
    const job = {
      id: 'job-1',
      job_type: 'projection_refresh',
      attempt_count: 1,
      payload: { user_id: 'user-1', reason: 'expense_changed', month: '2026-10' },
    };

    await processJob(job);

    expect(refreshProjectionNow).toHaveBeenCalledWith(expect.objectContaining({ user, month: '2026-10' }));
    expect(BackgroundJob.complete).toHaveBeenCalledWith('job-1', 'worker-1');
  });

  it('delegates post-confirm jobs to the idempotent handler', async () => {
    const job = {
      id: 'job-2', job_type: 'post_confirm', attempt_count: 1, payload: { expense_id: 'expense-1' },
    };
    await processJob(job);
    expect(runPostConfirmJob).toHaveBeenCalledWith(job.payload);
    expect(BackgroundJob.complete).toHaveBeenCalledWith('job-2', 'worker-1');
  });

  it('delegates Gmail enrichment after the import has been persisted', async () => {
    const job = {
      id: 'job-gmail',
      job_type: 'gmail_enrichment',
      attempt_count: 1,
      payload: { user_id: 'user-1', expense_id: 'expense-1' },
    };
    await processJob(job);
    expect(runGmailEnrichmentJob).toHaveBeenCalledWith(job.payload);
    expect(BackgroundJob.complete).toHaveBeenCalledWith('job-gmail', 'worker-1');
  });

  it('delegates Gmail mailbox work to the durable sync handler', async () => {
    const job = {
      id: 'job-gmail-sync',
      job_type: 'gmail_sync',
      attempt_count: 1,
      payload: { user_id: 'user-1', source: 'manual' },
    };
    await processJob(job);
    expect(runGmailSyncJob).toHaveBeenCalledWith(job.payload);
    expect(BackgroundJob.complete).toHaveBeenCalledWith('job-gmail-sync', 'worker-1');
  });

  it('delegates receipt scans to the durable extraction handler', async () => {
    const job = {
      id: 'job-receipt', job_type: 'receipt_scan', attempt_count: 1, payload: { scan_job_id: 'scan-1' },
    };
    await processJob(job);
    expect(runReceiptScanJob).toHaveBeenCalledWith(job.payload);
    expect(BackgroundJob.complete).toHaveBeenCalledWith('job-receipt', 'worker-1');
  });

  it('finalizes receipt jobs only after the worker exhausts retries', async () => {
    const error = new Error('provider down');
    runReceiptScanJob.mockRejectedValueOnce(error);
    BackgroundJob.fail.mockResolvedValueOnce({ status: 'dead' });
    const job = {
      id: 'job-receipt-dead', job_type: 'receipt_scan', attempt_count: 3, payload: { scan_job_id: 'scan-2' },
    };
    await processJob(job);
    expect(failDeadReceiptScanJob).toHaveBeenCalledWith(job.payload, error);
  });

  it('records a retry and captures failures without crashing the worker', async () => {
    const error = new Error('temporary failure');
    runPostConfirmJob.mockRejectedValueOnce(error);
    const job = {
      id: 'job-3', job_type: 'post_confirm', attempt_count: 2, payload: { expense_id: 'expense-1' },
    };

    await processJob(job);

    expect(BackgroundJob.fail).toHaveBeenCalledWith('job-3', 'worker-1', error, 2);
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({ job_id: 'job-3' }));
  });
});
