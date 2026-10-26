const RECEIPT_SCAN_TIMEOUT_MS = 70_000;
const NON_RETRYABLE_LIMIT_REASONS = new Set([
  'receipt_scan_daily_limit',
  'receipt_scan_monthly_limit',
  'receipt_scan_capacity_reached',
  'receipt_scan_access_required',
  'receipt_scan_concurrent_limit',
  'receipt_scan_retry_exhausted',
  'receipt_scan_velocity_limit',
  'receipt_scan_entitlement_paused',
]);
const RECEIPT_SCAN_POLL_INTERVAL_MS = 900;
const RECEIPT_SCAN_POLL_TIMEOUT_MS = 90_000;

function createReceiptScanRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function shouldRetryReceiptScan(error, attempt = 0) {
  if (attempt >= 1) return false;
  if (NON_RETRYABLE_LIMIT_REASONS.has(error?.reason_code)) return false;
  const status = Number(error?.status || 0);
  return ['network_error', 'request_timeout'].includes(error?.code)
    || [408, 429, 502, 503, 504].includes(status)
    || error?.reason_code === 'receipt_scan_in_progress'
    || error?.reason_code === 'ai_timeout'
    || error?.reason_code === 'ai_unavailable';
}

function receiptRetryDelayMs(error = {}) {
  const retryAfterSeconds = Number.parseFloat(error.retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(5_000, Math.max(500, retryAfterSeconds * 1000));
  }
  return 900;
}

async function pollReceiptScan(apiClient, queued, {
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const pollPath = queued.poll_path || `/expenses/scan-jobs/${queued.scan_job_id}`;
  const deadline = now() + RECEIPT_SCAN_POLL_TIMEOUT_MS;
  let state = queued;
  while (['queued', 'processing'].includes(state?.status)) {
    if (now() >= deadline) {
      const error = new Error('Receipt processing is taking longer than expected. It can be retried safely.');
      error.code = 'request_timeout';
      error.status = 408;
      error.reason_code = 'receipt_scan_poll_timeout';
      throw error;
    }
    await wait(RECEIPT_SCAN_POLL_INTERVAL_MS);
    state = await apiClient.get(pollPath, { dedupe: false });
  }
  if (state?.status === 'succeeded' && state.result) return state.result;
  const details = state?.error || {};
  const error = new Error(details.error || 'Could not read this receipt');
  Object.assign(error, details, {
    status: Number(details.status || 422),
    reason_code: details.reason_code || 'receipt_scan_failed',
  });
  throw error;
}

async function submitReceiptScan(apiClient, path, payload, options = {}) {
  const { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
  let attempt = 0;
  while (true) {
    try {
      const response = await apiClient.post(path, payload, { timeoutMs: RECEIPT_SCAN_TIMEOUT_MS });
      if (response?.scan_job_id && ['queued', 'processing'].includes(response.status)) {
        return pollReceiptScan(apiClient, response, options);
      }
      return response;
    } catch (error) {
      if (!shouldRetryReceiptScan(error, attempt)) throw error;
      attempt += 1;
      await wait(receiptRetryDelayMs(error));
    }
  }
}

module.exports = {
  RECEIPT_SCAN_TIMEOUT_MS,
  RECEIPT_SCAN_POLL_INTERVAL_MS,
  RECEIPT_SCAN_POLL_TIMEOUT_MS,
  createReceiptScanRequestId,
  pollReceiptScan,
  receiptRetryDelayMs,
  shouldRetryReceiptScan,
  submitReceiptScan,
};
