const assert = require('assert');
const { receiptScanErrorPresentation } = require('../services/receiptScanPresentation');

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

console.log('[mobile-logic] receipt scan presentation checks passed');
