jest.mock('../../src/db', () => ({
  pool: { connect: jest.fn() },
}));
jest.mock('../../src/models/backgroundJob', () => ({
  JOB_TYPES: { receiptScan: 'receipt_scan' },
  enqueue: jest.fn(),
}));
jest.mock('../../src/models/receiptScanJob', () => ({
  create: jest.fn(),
  fail: jest.fn(),
  findById: jest.fn(),
  findByRequest: jest.fn(),
  findForUser: jest.fn(),
  markInputDeleted: jest.fn(),
  markProcessing: jest.fn(),
  succeed: jest.fn(),
}));
jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/services/expenseIngestService', () => ({
  scanReceiptDocumentInput: jest.fn(),
  scanReceiptInput: jest.fn(),
}));
jest.mock('../../src/services/receiptScanUsageService', () => ({
  completeReceiptScan: jest.fn(),
  failReceiptScan: jest.fn(),
  reserveReceiptScan: jest.fn(),
}));
jest.mock('../../src/services/receiptScanStorage', () => ({
  deleteReceiptScanInput: jest.fn(),
  loadReceiptScanInput: jest.fn(),
  storeReceiptScanInput: jest.fn(),
}));

const db = require('../../src/db');
const BackgroundJob = require('../../src/models/backgroundJob');
const ReceiptScanJob = require('../../src/models/receiptScanJob');
const User = require('../../src/models/user');
const { scanReceiptInput } = require('../../src/services/expenseIngestService');
const {
  completeReceiptScan,
  failReceiptScan,
  reserveReceiptScan,
} = require('../../src/services/receiptScanUsageService');
const {
  deleteReceiptScanInput,
  loadReceiptScanInput,
  storeReceiptScanInput,
} = require('../../src/services/receiptScanStorage');
const { runReceiptScanJob, submitReceiptScanJob } = require('../../src/services/receiptScanJobService');

describe('receiptScanJobService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ReceiptScanJob.markProcessing.mockResolvedValue({});
    ReceiptScanJob.markInputDeleted.mockResolvedValue(undefined);
    deleteReceiptScanInput.mockResolvedValue(true);
    completeReceiptScan.mockResolvedValue(undefined);
    failReceiptScan.mockResolvedValue(undefined);
  });

  it('stages only an object reference in the durable background job', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    db.pool.connect.mockResolvedValueOnce(client);
    reserveReceiptScan.mockResolvedValueOnce({
      kind: 'reserved', requestId: 'request-1', usage: { remaining_month: 149 },
    });
    storeReceiptScanInput.mockResolvedValueOnce({ bucket: 'private-receipts', path: 'user-1/job.jpg' });
    ReceiptScanJob.create.mockResolvedValueOnce({ id: 'job-1', status: 'queued' });
    BackgroundJob.enqueue.mockResolvedValueOnce({ id: 'background-1' });

    const outcome = await submitReceiptScanJob({
      user: { id: 'user-1' },
      endpoint: 'image',
      inputBase64: '/9j/2Q==',
      inputHash: 'a'.repeat(64),
      requestKey: 'scan-request-1',
      mediaType: 'image/jpeg',
      todayDate: '2026-10-25',
    });

    expect(outcome.kind).toBe('queued');
    expect(BackgroundJob.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'receipt_scan',
      payload: { scan_job_id: expect.any(String) },
      queryable: client,
    }));
    expect(JSON.stringify(BackgroundJob.enqueue.mock.calls[0][0].payload)).not.toContain('/9j/2Q==');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('returns the existing job for an idempotent retry without uploading again', async () => {
    reserveReceiptScan.mockResolvedValueOnce({ kind: 'in_progress', requestId: 'request-existing' });
    ReceiptScanJob.findByRequest.mockResolvedValueOnce({ id: 'scan-existing', status: 'processing' });

    const outcome = await submitReceiptScanJob({
      user: { id: 'user-1' }, endpoint: 'image', inputBase64: '/9j/2Q==',
      inputHash: 'a'.repeat(64), requestKey: 'scan-request-existing',
      mediaType: 'image/jpeg', todayDate: '2026-10-25',
    });

    expect(outcome).toMatchObject({
      kind: 'queued', job: { scan_job_id: 'scan-existing', status: 'processing' },
    });
    expect(storeReceiptScanInput).not.toHaveBeenCalled();
  });

  it('reconciles model usage, stores the result, and deletes the staged input', async () => {
    const job = {
      id: 'scan-1', user_id: 'user-1', request_id: 'request-1', endpoint: 'image',
      storage_bucket: 'private-receipts', storage_path: 'user-1/scan-1.jpg',
      media_type: 'image/jpeg', today_date: '2026-10-25', status: 'queued',
    };
    ReceiptScanJob.findById.mockResolvedValueOnce(job);
    User.findById.mockResolvedValueOnce({ id: 'user-1', household_id: 'household-1' });
    loadReceiptScanInput.mockResolvedValueOnce('/9j/2Q==');
    scanReceiptInput.mockResolvedValueOnce({
      body: { merchant: 'Market', amount: 12.34 },
      modelUsage: { model_call_count: 1, model_input_tokens: 100, model_output_tokens: 20 },
    });

    await runReceiptScanJob({ scan_job_id: 'scan-1' });

    expect(completeReceiptScan).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      modelUsage: expect.objectContaining({ model_call_count: 1 }),
    }));
    expect(ReceiptScanJob.succeed).toHaveBeenCalledWith(
      'scan-1',
      { merchant: 'Market', amount: 12.34 },
      expect.objectContaining({ model_call_count: 1 })
    );
    expect(deleteReceiptScanInput).toHaveBeenCalledWith({
      bucket: 'private-receipts', path: 'user-1/scan-1.jpg',
    });
    expect(ReceiptScanJob.markInputDeleted).toHaveBeenCalledWith('scan-1');
  });

  it('does not charge the account allowance for an unusable extraction', async () => {
    const job = {
      id: 'scan-2', user_id: 'user-1', request_id: 'request-2', endpoint: 'image',
      storage_bucket: 'private-receipts', storage_path: 'user-1/scan-2.jpg',
      media_type: 'image/jpeg', today_date: '2026-10-25', status: 'queued',
    };
    ReceiptScanJob.findById.mockResolvedValueOnce(job);
    User.findById.mockResolvedValueOnce({ id: 'user-1' });
    loadReceiptScanInput.mockResolvedValueOnce('/9j/2Q==');
    scanReceiptInput.mockResolvedValueOnce({
      errorStatus: 422,
      errorBody: { error: 'Could not parse receipt', reason_code: 'missing_total' },
      modelUsage: { model_call_count: 1, model_input_tokens: 80, model_output_tokens: 10 },
    });

    await runReceiptScanJob({ scan_job_id: 'scan-2' });

    expect(failReceiptScan).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-2',
      modelUsage: expect.objectContaining({ model_call_count: 1 }),
    }));
    expect(ReceiptScanJob.fail).toHaveBeenCalledWith(
      'scan-2',
      expect.objectContaining({ reason_code: 'missing_total', status: 422 }),
      expect.objectContaining({ model_call_count: 1 })
    );
  });

  it('resumes reconciliation from a durable result without invoking the model again', async () => {
    ReceiptScanJob.findById.mockResolvedValueOnce({
      id: 'scan-3', user_id: 'user-1', request_id: 'request-3', status: 'succeeded',
      result_body: { merchant: 'Durable Market', amount: 4.5 },
      model_usage: { model_call_count: 1, model_input_tokens: 60, model_output_tokens: 12 },
      storage_bucket: 'private-receipts', storage_path: 'user-1/scan-3.jpg',
    });

    await runReceiptScanJob({ scan_job_id: 'scan-3' });

    expect(scanReceiptInput).not.toHaveBeenCalled();
    expect(completeReceiptScan).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-3',
      responseBody: { merchant: 'Durable Market', amount: 4.5 },
    }));
    expect(deleteReceiptScanInput).toHaveBeenCalled();
  });
});
