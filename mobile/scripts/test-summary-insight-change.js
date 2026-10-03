const assert = require('assert');
const {
  buildInsightPortfolio,
  buildSummaryInsightMovement,
  shouldUseLocalInsightMovement,
} = require('../services/summaryInsightChange');

function run() {
  const previous = buildInsightPortfolio([
    {
      id: 'dining',
      title: 'Dining is showing up in your spending',
      type: 'projected_category_surge',
      entity_type: 'category',
      entity_id: 'dining',
      metadata: { projected_budget_delta: 34 },
    },
  ]);
  const current = buildInsightPortfolio([
    {
      id: 'groceries',
      title: 'Groceries is showing up in your spending',
      type: 'projected_category_surge',
      entity_type: 'category',
      entity_id: 'groceries',
      metadata: { projected_budget_delta: 92 },
    },
    {
      id: 'dining',
      title: 'Dining is showing up in your spending',
      type: 'projected_category_surge',
      entity_type: 'category',
      entity_id: 'dining',
      metadata: { projected_budget_delta: 34 },
    },
  ]);

  const newMovement = buildSummaryInsightMovement(current, previous);
  assert.strictEqual(newMovement.state, 'new_insight_detected');
  assert.strictEqual(newMovement.source, 'insights');
  assert.strictEqual(newMovement.metric.display, '+$92');

  const topChanged = buildSummaryInsightMovement(current, [
    { key: 'category:dining', title: 'Dining is showing up in your spending', delta: 120 },
    { key: 'category:groceries', title: 'Groceries is showing up in your spending', delta: 40 },
  ]);
  assert.strictEqual(topChanged.state, 'top_driver_changed');

  assert.strictEqual(shouldUseLocalInsightMovement({ state: 'quiet_stable' }), true);
  assert.strictEqual(shouldUseLocalInsightMovement({ state: 'forecast_moved_up' }), false);
}

run();
console.log('summary insight change tests passed');
