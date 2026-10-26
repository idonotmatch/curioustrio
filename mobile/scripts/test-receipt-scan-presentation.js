const assert = require('assert');
const {
  receiptScanErrorPresentation,
  receiptScanUsagePresentation,
} = require('../services/receiptScanPresentation');

assert.deepStrictEqual(
  receiptScanErrorPresentation({ message: 'Could not parse receipt', reason_code: 'ai_unavailable' }),
  {
    title: 'Receipt scanner unavailable',
    message: 'The receipt scanner is temporarily unavailable. Try again shortly or enter the expense manually.',
    canRetry: true,
    canEnterManually: true,
  }
);

assert.deepStrictEqual(
  receiptScanErrorPresentation({ message: 'Could not parse receipt', reason_code: 'ai_timeout' }),
  {
    title: 'Receipt scan took too long',
    message: 'The image reached the scanner, but processing timed out. Try once more or enter the expense manually.',
    canRetry: true,
    canEnterManually: true,
  }
);

assert.strictEqual(
  receiptScanErrorPresentation({ message: 'Could not parse receipt', reason_code: 'missing_total' }).title,
  'Could not read receipt'
);
assert.strictEqual(
  receiptScanErrorPresentation({ message: 'receipt image too large' }).title,
  'Image too large'
);
assert.strictEqual(receiptScanErrorPresentation({ message: 'network error' }), null);
assert.strictEqual(receiptScanErrorPresentation({ status: 429 }).title, 'Scanner is busy');
assert.deepStrictEqual(
  receiptScanErrorPresentation({ reason_code: 'receipt_scan_daily_limit', status: 429 }),
  {
    title: 'Scan allowance reached',
    message: 'You have used the receipt scans available today. Manual entry is still available.',
    canRetry: false,
    canEnterManually: true,
  }
);
assert.strictEqual(
  receiptScanErrorPresentation({ reason_code: 'receipt_scan_capacity_reached', status: 503 }).canRetry,
  false
);
assert.strictEqual(
  receiptScanErrorPresentation({ reason_code: 'receipt_scan_concurrent_limit', status: 409 }).title,
  'Scan already in progress'
);
assert.strictEqual(receiptScanErrorPresentation({ reason_code: 'unsupported_image_type' }).title, 'Image format not supported');
assert.strictEqual(receiptScanErrorPresentation({ code: 'request_timeout' }).title, 'Receipt scan took too long');
assert.strictEqual(receiptScanUsagePresentation({ remaining_today: 12, remaining_month: 90 }), null);
assert.strictEqual(receiptScanUsagePresentation({ remaining_today: null, remaining_month: 90 }), null);
assert.deepStrictEqual(
  receiptScanUsagePresentation({ remaining_today: 5, remaining_month: 80, cached: false }),
  { title: 'Receipt scans remaining', message: '5 receipt scans remaining today.' }
);
assert.strictEqual(receiptScanUsagePresentation({ remaining_today: 5, cached: true }), null);

console.log('[mobile-logic] receipt scan presentation checks passed');
