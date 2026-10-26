const assert = require('assert');
const {
  RECEIPT_SCAN_TIMEOUT_MS,
  createReceiptScanRequestId,
  pollReceiptScan,
  shouldRetryReceiptScan,
  submitReceiptScan,
} = require('../services/receiptScanClient');

async function run() {
  assert(RECEIPT_SCAN_TIMEOUT_MS >= 60_000);
  assert.match(createReceiptScanRequestId(), /^[A-Za-z0-9._:-]{8,128}$/);
  assert.strictEqual(shouldRetryReceiptScan({ status: 503 }, 0), true);
  assert.strictEqual(shouldRetryReceiptScan({ status: 429, reason_code: 'receipt_scan_daily_limit' }, 0), false);
  assert.strictEqual(shouldRetryReceiptScan({ status: 503, reason_code: 'receipt_scan_capacity_reached' }, 0), false);
  assert.strictEqual(shouldRetryReceiptScan({ status: 409, reason_code: 'receipt_scan_in_progress' }, 0), true);
  assert.strictEqual(shouldRetryReceiptScan({ status: 422 }, 0), false);
  assert.strictEqual(shouldRetryReceiptScan({ status: 503 }, 1), false);

  let calls = 0;
  const client = {
    post: async (_path, _payload, options) => {
      calls += 1;
      assert.strictEqual(options.timeoutMs, RECEIPT_SCAN_TIMEOUT_MS);
      if (calls === 1) throw Object.assign(new Error('busy'), { status: 503 });
      return { merchant: 'Recovered' };
    },
  };
  const result = await submitReceiptScan(client, '/expenses/scan', {}, { wait: async () => {} });
  assert.deepStrictEqual(result, { merchant: 'Recovered' });
  assert.strictEqual(calls, 2);

  let polls = 0;
  const queuedClient = {
    get: async (path, options) => {
      polls += 1;
      assert.strictEqual(path, '/expenses/scan-jobs/job-123');
      assert.deepStrictEqual(options, { dedupe: false });
      return polls === 1
        ? { scan_job_id: 'job-123', status: 'processing' }
        : { scan_job_id: 'job-123', status: 'succeeded', result: { merchant: 'Queued Market' } };
    },
  };
  const queuedResult = await pollReceiptScan(
    queuedClient,
    { scan_job_id: 'job-123', status: 'queued' },
    { wait: async () => {} }
  );
  assert.deepStrictEqual(queuedResult, { merchant: 'Queued Market' });
  assert.strictEqual(polls, 2);

  await assert.rejects(
    pollReceiptScan(
      { get: async () => ({ status: 'failed', error: { error: 'Unreadable', reason_code: 'missing_total', status: 422 } }) },
      { scan_job_id: 'job-failed', status: 'queued' },
      { wait: async () => {} }
    ),
    (error) => error.reason_code === 'missing_total' && error.status === 422
  );
  console.log('[mobile-logic] receipt scan client checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
