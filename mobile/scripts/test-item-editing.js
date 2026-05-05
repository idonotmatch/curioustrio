const assert = require('assert');
const {
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

  assert.deepStrictEqual(
    seeded,
    {
      description: 'OLIPOP',
      amount: '5.37',
      quantity: '3',
      unit_price: '1.79',
    },
    'editable items should seed string values for quantity-aware editing'
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
      upc: null,
      sku: null,
      brand: null,
      product_size: null,
      pack_size: null,
      unit: 'can',
    },
    'normalized payloads should preserve quantity fields and trim descriptions'
  );

  process.stdout.write('[mobile-logic] item editing checks passed\n');
}

run();
