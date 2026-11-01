const {
  buildWidgetSnapshot,
  currentBudgetPeriod,
  paceState,
} = require('../../src/services/widgetSnapshotService');

describe('widgetSnapshotService', () => {
  test('builds a privacy-safe pace snapshot without monetary values', () => {
    const snapshot = buildWidgetSnapshot({
      budgetLimit: 2500,
      spent: 500,
      pendingCount: 3,
      startDay: 1,
      today: '2026-11-10',
      generatedAt: '2026-11-10T12:00:00.000Z',
    });

    expect(snapshot).toEqual({
      schema_version: 1,
      period: { from: '2026-11-01', to: '2026-12-01', label: 'November' },
      pace: {
        state: 'below',
        label: 'Below pace',
        spending_ratio: 0.2,
        period_elapsed_ratio: 1 / 3,
      },
      pending_review_count: 3,
      generated_at: '2026-11-10T12:00:00.000Z',
    });
    expect(JSON.stringify(snapshot)).not.toContain('2500');
    expect(JSON.stringify(snapshot)).not.toContain('500');
  });

  test('rolls a custom budget period into the prior month', () => {
    const period = currentBudgetPeriod('2026-11-05', 15);
    expect(period.from.toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(period.to.toISOString().slice(0, 10)).toBe('2026-11-15');

    const snapshot = buildWidgetSnapshot({
      budgetLimit: 1000,
      spent: 650,
      pendingCount: 0,
      startDay: 15,
      today: '2026-11-05',
    });
    expect(snapshot.period.label).toBe('Oct 15 - Nov 14');
    expect(snapshot.pace.state).toBe('on_pace');
  });

  test('handles missing budgets and spending beyond the budget', () => {
    expect(paceState({ budgetLimit: 0, spendingRatio: 0, elapsedRatio: 0.5 })).toEqual({
      key: 'setup',
      label: 'Set a budget',
    });
    expect(paceState({ budgetLimit: 100, spendingRatio: 1.1, elapsedRatio: 0.5 })).toEqual({
      key: 'reached',
      label: 'Budget reached',
    });
  });

  test('falls back safely when a client sends an impossible date', () => {
    const period = currentBudgetPeriod('2026-02-31', 1);
    expect(period.today.getUTCDate()).toBeGreaterThanOrEqual(1);
    expect(period.from.getUTCDate()).toBe(1);
  });
});
