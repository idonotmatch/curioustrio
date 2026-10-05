const assert = require('assert');
const {
  RECEIPT_IMAGE_MAX_BASE64_LENGTH,
  fallbackReceiptImagePlan,
  primaryReceiptImagePlan,
} = require('../services/receiptImagePreparation');

function run() {
  const tall = primaryReceiptImagePlan({ width: 3024, height: 8064 });
  assert.strictEqual(tall.width, 2100);
  assert.strictEqual(tall.compress, 0.78);
  assert.strictEqual(tall.is_tall_receipt, true);

  const standard = primaryReceiptImagePlan({ width: 4032, height: 3024 });
  assert.strictEqual(standard.width, 1800);
  assert.strictEqual(standard.compress, 0.72);

  const small = primaryReceiptImagePlan({ width: 1200, height: 1800 });
  assert.strictEqual(small.width, 1200, 'small images should not be upscaled');

  const fallback = fallbackReceiptImagePlan({ width: 3024 });
  assert.deepStrictEqual(fallback, { width: 1450, compress: 0.58, is_tall_receipt: false });
  assert(RECEIPT_IMAGE_MAX_BASE64_LENGTH < 3_000_000);

  process.stdout.write('[mobile-logic] receipt image preparation checks passed\n');
}

run();
