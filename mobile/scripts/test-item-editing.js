const assert = require('assert');
const {
  buildItemReviewPresentation,
  buildExpenseItemsPatch,
  createEditableExpenseItem,
  normalizeExpenseItemPayload,
  updateEditableExpenseItem,
} = require('../services/itemEditing');

function run() {
  const seeded = createEditableExpenseItem({
    description: 'OLIPOP',
    amount: 5.37,
    quantity: 3,
    unit_price: 1.79,
  });

  assert(seeded.observation_key.startsWith('item:'), 'editable items should receive a stable observation key');
  assert.deepStrictEqual({
    description: seeded.description,
    raw_description: seeded.raw_description,
    amount: seeded.amount,
    quantity: seeded.quantity,
    unit_price: seeded.unit_price,
  }, {
    description: 'OLIPOP',
    raw_description: 'OLIPOP',
    amount: '5.37',
    quantity: '3',
    unit_price: '1.79',
  }, 'editable items should seed string values and preserve the raw label');

  assert.deepStrictEqual(
    buildExpenseItemsPatch([], { includeItems: false }),
    {},
    'edits should omit line items until item data has hydrated'
  );
  assert.deepStrictEqual(
    buildExpenseItemsPatch([{ description: ' Milk ', amount: '4.25' }]),
    { items: [expectItemPayload('Milk', 4.25)] },
    'hydrated line item edits should be included explicitly'
  );

  const fromQuantityChange = updateEditableExpenseItem(
    { description: 'OLIPOP', quantity: '2', unit_price: '1.79', amount: '3.58' },
    'quantity',
    '3'
  );
  assert.strictEqual(fromQuantityChange.amount, '5.37', 'quantity changes should recompute total when each price is present');

  const fromAmountChange = updateEditableExpenseItem(
    { description: 'OLIPOP', quantity: '3', unit_price: '', amount: '5.37' },
    'amount',
    '6.00'
  );
  assert.strictEqual(fromAmountChange.unit_price, '2.00', 'amount changes should backfill each price when quantity exists');

  const fromEachChange = updateEditableExpenseItem(
    { description: 'OLIPOP', quantity: '3', unit_price: '2.00', amount: '6.00' },
    'unit_price',
    '1.50'
  );
  assert.strictEqual(fromEachChange.amount, '4.50', 'each-price changes should recompute total when quantity exists');
  assert.strictEqual(fromEachChange.extraction_confidence, 'high', 'a user item edit should become high-confidence input');

  assert.deepStrictEqual(
    buildItemReviewPresentation(
      { item_total_status: 'unpriced' },
      [{ description: 'chicken', amount: '' }, { description: 'berries', amount: '' }],
      '48.12'
    ),
    {
      tone: 'neutral',
      title: '2 items found',
      body: 'Add prices if you know them, or save now and keep the item names for matching and trends.',
    },
    'unpriced natural-language items should get lightweight, non-blocking guidance'
  );

  const mismatchPresentation = buildItemReviewPresentation(
    { item_total_status: 'mismatch' },
    [{ description: 'salmon', amount: '18.50' }, { description: 'asparagus', amount: '6.20' }],
    '31.40'
  );
  assert.strictEqual(mismatchPresentation.title, 'Check the item total');
  assert(mismatchPresentation.body.includes('$24.70'), 'mismatch guidance should show the parsed item sum');
  assert(mismatchPresentation.body.includes('$31.40'), 'mismatch guidance should show the expense total');

  const receiptSubtotalPresentation = buildItemReviewPresentation(
    { subtotal: 24.70 },
    [{ description: 'salmon', amount: '18.50' }, { description: 'asparagus', amount: '6.20' }],
    '26.89'
  );
  assert.strictEqual(receiptSubtotalPresentation, null, 'receipt items should reconcile to subtotal rather than the tax-inclusive paid total');

  const discountedSubtotalPresentation = buildItemReviewPresentation(
    { subtotal: 11, discounts: 1 },
    [{ description: 'water', amount: '6.50' }, { description: 'bananas', amount: '1.50' }, { description: 'bread', amount: '4.00' }],
    '11.88'
  );
  assert.strictEqual(discountedSubtotalPresentation, null, 'receipt-wide savings should explain a product-sum versus net-subtotal difference');

  const payload = normalizeExpenseItemPayload({
    description: '  OLIPOP  ',
    amount: '5.37',
    quantity: '3',
    unit_price: '1.79',
    unit: 'can',
  });
  assert.deepStrictEqual(
    payload,
    {
      description: 'OLIPOP',
      amount: 5.37,
      quantity: 3,
      unit_price: 1.79,
      pricing_unit: null,
      item_type: null,
      upc: null,
      sku: null,
      brand: null,
      product_size: null,
      pack_size: null,
      unit: 'can',
      observation_key: null,
      source_type: null,
      raw_description: 'OLIPOP',
      extraction_confidence: null,
    },
    'normalized payloads should preserve quantity fields and trim descriptions'
  );

  process.stdout.write('[mobile-logic] item editing checks passed\n');
}

function expectItemPayload(description, amount) {
  return {
    description,
    amount,
    quantity: null,
    unit_price: null,
    pricing_unit: null,
    item_type: null,
    upc: null,
    sku: null,
    brand: null,
    product_size: null,
    pack_size: null,
    unit: null,
    observation_key: null,
    source_type: null,
    raw_description: description,
    extraction_confidence: null,
  };
}

run();
