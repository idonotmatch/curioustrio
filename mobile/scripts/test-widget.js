const assert = require('assert');
const {
  INITIAL_WIDGET_PROPS,
  paceTone,
  reviewLabel,
  widgetPropsFromSnapshot,
} = require('../services/widgetSnapshotPresentation');
const { QUICK_ADD_ROUTE, isWidgetQuickAddUrl } = require('../services/widgetQuickAdd');

function run() {
  assert.strictEqual(QUICK_ADD_ROUTE, '/quick-add');
  assert.strictEqual(isWidgetQuickAddUrl('adlo://quick-add?source=widget'), true);
  assert.strictEqual(isWidgetQuickAddUrl('adlo:///quick-add'), true);
  assert.strictEqual(isWidgetQuickAddUrl('adlo://summary'), false);
  assert.strictEqual(isWidgetQuickAddUrl('https://example.com/quick-add?source=widget'), false);

  assert.strictEqual(reviewLabel(0), 'No expenses to review');
  assert.strictEqual(reviewLabel(1), '1 expense to review');
  assert.strictEqual(reviewLabel(4), '4 expenses to review');
  assert.strictEqual(paceTone('high'), 'attention');
  assert.strictEqual(paceTone('below'), 'positive');

  const props = widgetPropsFromSnapshot({
    schema_version: 1,
    period: { label: 'November' },
    pace: {
      state: 'elevated',
      label: 'A little high',
      spending_ratio: 1.4,
      period_elapsed_ratio: -0.2,
    },
    family_pace: {
      state: 'below',
      label: 'Below pace',
      spending_ratio: 0.42,
    },
    pending_review_count: 2,
  });
  assert.deepStrictEqual(props, {
    periodLabel: 'November',
    paceLabel: 'A little high',
    paceTone: 'caution',
    spendingRatio: 1,
    hasFamilyBudget: true,
    familyPaceLabel: 'Below pace',
    familyPaceTone: 'positive',
    familySpendingRatio: 0.42,
    elapsedRatio: 0,
    reviewLabel: '2 expenses to review',
    signedIn: true,
  });
  assert.deepStrictEqual(widgetPropsFromSnapshot(null), { ...INITIAL_WIDGET_PROPS });

  process.stdout.write('[mobile-logic] widget checks passed\n');
}

run();
