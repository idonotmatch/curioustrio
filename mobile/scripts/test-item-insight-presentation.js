const assert = require('assert');
const {
  getItemInsightEvidence,
  getItemInsightSummary,
} = require('../services/itemInsightPresentation');

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
  merchant_evidence_count: 4,
});
assert.ok(merchantSummary.whyItMatters.includes('across 4 comparable purchases'));

assert.deepStrictEqual(getItemInsightEvidence({
  evidence_count: 4,
  identity_confidence: 'high',
  confidence_reason: 'Matched across repeated purchases',
}), {
  label: 'Strong evidence',
  detail: '4 supporting purchases - Matched across repeated purchases',
});

process.stdout.write('[mobile-logic] item insight presentation checks passed\n');
