const assert = require('assert');
const { selectInsightEvidence } = require('../services/insightEvidence');
const {
  getInsightCardCopy,
  getInsightSupportRows,
  getPrimaryActionForInsight,
} = require('../services/insightPresentation');
const {
  buildInsightPurchaseHistoryRows,
  getInsightEvidenceMode,
} = require('../services/insightDetailPresentation');

const periodEvidence = selectInsightEvidence([
  { id: 'older', date: '2026-09-03', amount: 20 },
  { id: 'recent', date: '2026-09-26', amount: 75 },
  { date: '2026-09-30', amount: 500 },
], 'period', { date: '2026-09-30' }, 2);
assert.deepStrictEqual(periodEvidence.map((row) => row.id), ['recent', 'older']);

const purchaseHistory = buildInsightPurchaseHistoryRows({
  purchases: [{
    expense_id: 'expense-123',
    expense_item_id: 'item-456',
    merchant: 'Market',
    amount: '12.50',
  }],
});
assert.deepStrictEqual(purchaseHistory[0], {
  id: 'expense-123',
  expense_id: 'expense-123',
  expense_item_id: 'item-456',
  key: 'item-456',
  date: null,
  merchant: 'Market',
  amount: 12.5,
  estimated_unit_price: null,
  normalized_total_size_value: null,
  normalized_total_size_unit: null,
});

assert.strictEqual(
  getInsightEvidenceMode('one_off_expense_skewing_projection', { top_unusual_expense: { id: 'expense-1' } }),
  'largest_expense'
);
assert.strictEqual(getInsightEvidenceMode('developing_weekly_spend_change', {}), 'period');

assert.deepStrictEqual(getInsightSupportRows({
  type: 'early_top_category',
  metadata: {
    category_name: 'Groceries',
    category_spend: 210,
    category_count: 6,
  },
}, { limit: 3 }), [
  { label: 'Category', value: 'Groceries' },
  { label: 'Spend so far', value: '$210' },
  { label: 'Expenses', value: '6 expenses' },
]);

assert.deepStrictEqual(getInsightCardCopy({
  type: 'item_repurchase_accelerating',
  title: 'AVOCADOS is showing up sooner than usual',
  metadata: {
    item_name: 'Avocados',
    latest_gap_days: 14,
    average_gap_days: 25,
  },
}), {
  title: 'Avocados is repeating sooner',
  body: '',
});

assert.deepStrictEqual(getInsightCardCopy({
  type: 'projected_category_surge',
  metadata: {
    category_name: 'Shopping',
    delta_amount: 86,
  },
}), {
  title: 'Shopping may finish high',
  body: '',
});

assert.deepStrictEqual(getInsightCardCopy({
  type: 'one_off_expense_skewing_projection',
  metadata: { largest_expense: { merchant: 'Costco' } },
}), {
  title: 'One purchase is skewing the month',
  body: 'Costco is driving the difference.',
});

assert.deepStrictEqual(getInsightCardCopy({
  type: 'usage_ready_to_plan',
  metadata: { planning_confidence: 'directional' },
}), {
  title: 'You have enough history to plan',
  body: 'Start with a smaller what-if.',
});

const evidenceAction = getPrimaryActionForInsight({
  insightType: 'developing_repeated_merchant',
  scope: 'personal',
  month: '2026-09',
  metadata: { merchant_name: 'Market' },
});
assert.strictEqual(evidenceAction.local_action, 'show_evidence');
assert.strictEqual(evidenceAction.cta, 'Review supporting expenses');

const budgetAction = getPrimaryActionForInsight({
  insightType: 'budget_too_low',
  scope: 'personal',
  month: '2026-09',
  metadata: {},
});
assert.strictEqual(budgetAction.route, '/budget-period');

const itemAction = getPrimaryActionForInsight({
  insightType: 'recurring_cheaper_elsewhere',
  scope: 'personal',
  month: '2026-09',
  metadata: { group_key: 'product:yogurt', item_name: 'Greek Yogurt' },
});
assert.deepStrictEqual(itemAction.route, {
  pathname: '/recurring-item',
  params: {
    group_key: 'product:yogurt',
    scope: 'personal',
    title: 'Greek Yogurt',
    insight_type: 'recurring_cheaper_elsewhere',
  },
});

const projectionAction = getPrimaryActionForInsight({
  insightType: 'projected_month_end_over_budget',
  scope: 'household',
  month: '2026-09',
  metadata: { projected_budget_delta: 42 },
});
assert.deepStrictEqual(projectionAction.route, {
  pathname: '/scenario-check',
  params: { scope: 'household', month: '2026-09' },
});

process.stdout.write('[mobile-logic] insight usefulness checks passed\n');
