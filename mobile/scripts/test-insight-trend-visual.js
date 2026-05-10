const assert = require('assert');
const { getInsightTrendVisual } = require('../services/insightTrendVisual');

function run() {
  const pace = getInsightTrendVisual({
    type: 'early_budget_pace',
    metadata: { budget_used_percent: 62 },
  });
  assert.strictEqual(pace.variant, 'pace', 'budget pace should use the pace visual');
  assert.strictEqual(pace.value, '62% used', 'budget pace should expose percent used');

  const spark = getInsightTrendVisual({
    type: 'developing_category_shift',
    metadata: { current_spend_to_date: 180, previous_spend: 120, delta_percent: 50 },
  });
  assert.strictEqual(spark.variant, 'spark', 'category movement should use the spark visual');
  assert.ok(Array.isArray(spark.points) && spark.points.length >= 2, 'spark visuals should include normalized points');

  const rhythm = getInsightTrendVisual({
    type: 'early_repeated_merchant',
    metadata: { merchant_count: 3 },
  });
  assert.strictEqual(rhythm.variant, 'rhythm', 'repeated merchant should use the rhythm visual');
  assert.strictEqual(rhythm.value, '3x', 'rhythm visuals should expose repeat count');

  const projected = getInsightTrendVisual({
    type: 'projected_month_end_over_budget',
    metadata: { budget_used_percent: 68, projected_budget_delta: 84 },
    forecast: {
      forecast_type: 'month_end_budget',
      projected_value: 1184,
      projected_delta: 84,
      confidence_label: 'directional',
    },
  });
  assert.strictEqual(projected.projection.value, '+$84 projected', 'forecast payloads should add projection copy');

  const projectedFallback = getInsightTrendVisual({
    type: 'early_top_category',
    metadata: { month: '2026-05', current_spend_to_date: 292, previous_spend: 120, active_day_count: 7, delta_amount: 292 },
  });
  assert.strictEqual(projectedFallback.projection.label, 'If pace holds', 'metadata-only trend cards should still show projection copy');
  assert.strictEqual(projectedFallback.projection.value, '+$1.3k vs usual', 'metadata-only category trends should project the elevated run rate');

  const missing = getInsightTrendVisual({
    type: 'developing_weekly_spend_change',
    metadata: {},
  });
  assert.strictEqual(missing, null, 'insufficient metadata should render no visual');

  process.stdout.write('[mobile-logic] insight trend visual checks passed\n');
}

run();
