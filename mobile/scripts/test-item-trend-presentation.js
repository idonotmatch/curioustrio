const assert = require('assert');
const {
  filterItemTrendRows,
  formatItemTrendPrice,
  getItemPriceTrendVisual,
  getItemTrendChange,
} = require('../services/itemTrendPresentation');

const rows = [
  {
    item_name: 'Sparkling Water',
    brand: 'Water Co',
    latest_merchant: 'Target',
    latest_price: 0.08,
    price_kind: 'unit',
    price_basis_unit: 'fl_oz',
    price_change_percent: 14.2,
    merchant_count: 2,
  },
  {
    item_name: 'Greek Yogurt',
    latest_merchant: 'Market',
    latest_price: 5.49,
    price_kind: 'item',
    price_change_percent: 0.5,
    merchant_count: 1,
  },
];

assert.strictEqual(formatItemTrendPrice(rows[0]), '$0.08 / fl oz');
assert.deepStrictEqual(getItemTrendChange(rows[0]), { label: '14% higher', direction: 'up' });
assert.deepStrictEqual(getItemTrendChange(rows[1]), { label: 'About the same', direction: 'neutral' });
assert.deepStrictEqual(filterItemTrendRows(rows, { query: 'target' }), [rows[0]]);
assert.deepStrictEqual(filterItemTrendRows(rows, { filter: 'changed' }), [rows[0]]);
assert.deepStrictEqual(filterItemTrendRows(rows, { filter: 'stores' }), [rows[0]]);

const visual = getItemPriceTrendVisual({
  median_amount: 6,
  purchases: [
    { date: '2026-08-01', item_amount: 5.5 },
    { date: '2026-09-01', item_amount: 6 },
    { date: '2026-10-01', item_amount: 6.5 },
  ],
});
assert.strictEqual(visual.variant, 'spark');
assert.strictEqual(visual.value, '$6.50');
assert.deepStrictEqual(visual.points, [0, 0.5, 1]);
assert.deepStrictEqual(visual.projection, { label: 'Typical', value: '$6.00' });

process.stdout.write('[mobile-logic] item trend presentation checks passed\n');
