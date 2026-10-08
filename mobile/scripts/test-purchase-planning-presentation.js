const assert = require('assert');
const { strategyCopy, planChangeCopy, priceStatusCopy, fundingHistoryCopy } = require('../services/purchasePlanningPresentation');

assert.strictEqual(strategyCopy({ recommended_strategy: 'funded_now' }).title, 'You have ways to cover this');
assert.ok(strategyCopy({ recommended_strategy: 'rebalance_and_recover', funding_gap: 300, recovery_monthly: 100 }).body.includes('$100'));
assert.strictEqual(planChangeCopy({ material_change: 'improved' }), 'Funding got easier');
assert.ok(priceStatusCopy({ target_price: 50 }, { observed_price: 45 }).includes('at your target'));
assert.ok(priceStatusCopy({}, { observed_price: 45, metadata: { price_merchant: 'Retailer B' } }).includes('Retailer B'));
assert.ok(fundingHistoryCopy([{ funding_gap: 100 }, { funding_gap: 180 }]).includes('$80'));

console.log('[purchase-planning-presentation] checks passed');
