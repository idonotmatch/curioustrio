const assert = require('assert');
const {
  formatMatchSize,
  formatMatchSource,
  getCandidateSide,
  getCandidateSummary,
  getPurchaseMeta,
} = require('../services/itemFamilyReviewPresentation');

const candidate = {
  left_label: 'Chicken Breast',
  right_label: 'Boneless Chicken Breast',
  evidence: {
    left_occurrence_count: 3,
    right_occurrence_count: 1,
    left_merchants: ['Market'],
    right_merchants: ['Warehouse Club'],
    left_first_purchased_at: '2026-08-02',
    left_last_purchased_at: '2026-10-12',
    left_purchases: [{
      expense_id: 'expense-1',
      merchant: 'Market',
      date: '2026-10-12',
      amount: 8.5,
      normalized_total_size_value: 32,
      normalized_total_size_unit: 'oz',
      source_type: 'camera',
    }],
  },
};

assert.deepStrictEqual(getCandidateSummary(candidate), {
  purchaseCount: 4,
  eyebrow: '4 purchases · 2 merchants',
  sameDisplayLabel: false,
});
assert.deepStrictEqual(getCandidateSide(candidate, 'left').purchases, candidate.evidence.left_purchases);
assert.strictEqual(formatMatchSize(candidate.evidence.left_purchases[0]), '32 oz');
assert.strictEqual(formatMatchSource('camera'), 'Receipt photo');
assert.match(getPurchaseMeta(candidate.evidence.left_purchases[0]), /^Oct 12 · \$8\.50 · 32 oz$/);

process.stdout.write('[mobile-logic] item family review presentation checks passed\n');
