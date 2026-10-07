const assert = require('assert');
const {
  buildReceiptBreakdownPresentation,
  createEditableReceiptDetails,
  normalizeReceiptDetailsPayload,
  receiptDetailChangedFields,
} = require('../services/receiptDetailsEditing');

const editable = createEditableReceiptDetails({
  currency: 'usd',
  subtotal: 20,
  tax: 1.6,
  discounts: 2,
  transaction_id: ' TX-9 ',
  purchase_time: '14:05',
  store_number: '104',
});
assert.deepStrictEqual(editable, {
  currency: 'USD',
  subtotal: '20.00',
  tax: '1.60',
  tip: '',
  fees: '',
  discounts: '2.00',
  transaction_id: 'TX-9',
  purchase_time: '14:05',
  store_number: '104',
});

assert.deepStrictEqual(normalizeReceiptDetailsPayload({
  ...editable,
  discounts: '-2.00',
}), {
  currency: 'USD',
  subtotal: 20,
  tax: 1.6,
  tip: null,
  fees: null,
  discounts: 2,
  transaction_id: 'TX-9',
  purchase_time: '14:05',
  store_number: '104',
});

assert.deepStrictEqual(
  receiptDetailChangedFields(editable, { ...editable, tax: '1.70', transaction_id: 'TX-10' }),
  ['tax', 'transaction_id']
);
assert.strictEqual(buildReceiptBreakdownPresentation(editable, 21.6), null);
assert.deepStrictEqual(buildReceiptBreakdownPresentation(editable, 25), {
  title: 'Check the receipt breakdown',
  body: 'Subtotal, tax, tip, and fees add to $21.60, while the paid total is $25.00.',
});

process.stdout.write('[mobile-logic] receipt details editing checks passed\n');
