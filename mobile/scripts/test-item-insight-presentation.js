const assert = require('assert');
const {
  getItemInsightEvidence,
  getItemInsightSummary,
} = require('../services/itemInsightPresentation');
const {
  itemMatchLabel,
  itemSubmeta,
} = require('../services/expenseDetailPresentation');
const {
  getInsightPrimaryMetric,
  getInsightSupportRows,
} = require('../services/insightPresentation');

const priceSummary = getItemInsightSummary('item_recent_price_jump', {
  item_name: 'Greek Yogurt',
  latest_merchant: 'Market',
  delta_percent: 50,
  baseline_amount: 8,
  baseline_purchase_count: 2,
}, null, 'Greek Yogurt cost more than usual.');
assert.ok(priceSummary.whyItMatters.includes('previous 2 purchases'));
assert.ok(priceSummary.nextStep.includes('Correct the item or amount'));

const lapsedSummary = getItemInsightSummary('item_pattern_lapsed', {
  item_name: 'Laundry Detergent',
  days_since_last_purchase: 30,
  average_gap_days: 14,
});
assert.ok(lapsedSummary.whyItMatters.includes('30 days'));
assert.ok(lapsedSummary.nextStep.includes('matched to a different item'));

const merchantSummary = getItemInsightSummary('item_merchant_variance', {
  item_name: 'Paper Towels',
  cheaper_merchant: 'Target',
  pricier_merchant: 'Whole Foods',
  delta_percent: 20,
  delta_amount: 2.5,
  cheaper_value: 10,
  merchant_evidence_count: 4,
});
assert.ok(merchantSummary.whyItMatters.includes('across 4 comparable purchases'));
assert.ok(merchantSummary.whyItMatters.includes('$2.50 per buy'));

const merchantInsight = {
  type: 'item_merchant_variance',
  entity_type: 'item',
  metadata: {
    group_key: 'product:towels',
    cheaper_merchant: 'Target',
    cheaper_value: 10,
    delta_amount: 2.5,
    delta_percent: 20,
    merchant_evidence_count: 4,
  },
};
assert.deepStrictEqual(getInsightPrimaryMetric(merchantInsight), { value: '$2.50', label: 'less per buy' });
assert.deepStrictEqual(getInsightSupportRows(merchantInsight, { limit: 3 }), [
  { label: 'Best merchant', value: 'Target' },
  { label: 'Estimated savings', value: '$2.50' },
  { label: 'Typical at Target', value: '$10.00' },
]);

const dueSummary = getItemInsightSummary('recurring_repurchase_due', {
  item_name: 'Greek Yogurt',
  average_gap_days: 14,
  usual_merchant: 'Market',
  typical_cost: 7.25,
});
assert.ok(dueSummary.whyItMatters.includes('Market'));
assert.ok(dueSummary.whyItMatters.includes('$7.25'));

const dueInsight = {
  type: 'recurring_repurchase_due',
  entity_type: 'item',
  metadata: {
    group_key: 'product:yogurt',
    days_until_due: 2,
    average_gap_days: 14,
    usual_merchant: 'Market',
    typical_cost: 7.25,
  },
};
assert.deepStrictEqual(getInsightPrimaryMetric(dueInsight), { value: '2d', label: 'until due' });
assert.deepStrictEqual(getInsightSupportRows(dueInsight, { limit: 2 }), [
  { label: 'Usual store', value: 'Market' },
  { label: 'Usual cost', value: '$7.25' },
]);

const bundleSummary = getItemInsightSummary('recurring_repurchase_due', {
  bundle_item_count: 2,
  bundle_co_purchase_count: 3,
  usual_merchant: 'Market',
  typical_cost: 12.75,
});
assert.ok(bundleSummary.whyItMatters.includes('appeared together 3 times'));

assert.deepStrictEqual(getItemInsightEvidence({
  evidence_count: 4,
  identity_confidence: 'high',
  confidence_reason: 'Matched across repeated purchases',
}), {
  label: 'Strong evidence',
  detail: '4 supporting purchases - Matched across repeated purchases',
});

assert.strictEqual(
  itemMatchLabel({ product_id: 'product-1', product_match_confidence: 'medium' }),
  'Possible match'
);
assert.strictEqual(
  itemSubmeta({ product_match_reason: 'name_variant_match' }),
  'Similar name at the same merchant'
);
assert.strictEqual(
  itemSubmeta({ product_match_reason: 'cross_merchant_variant_match' }),
  'Same brand and package across merchants'
);
assert.strictEqual(
  itemMatchLabel({ comparable_key: 'paper towel', product_match_reason: 'user_rejected_match' }),
  'Kept separate'
);

process.stdout.write('[mobile-logic] item insight presentation checks passed\n');
