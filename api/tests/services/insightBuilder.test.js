const {
  portfolioFamily,
  orchestrateInsightPortfolio,
} = require('../../src/services/insightBuilder');

function buildInsight(overrides = {}) {
  return {
    id: overrides.id || `insight-${Math.random()}`,
    type: overrides.type || 'top_category_driver',
    severity: overrides.severity || 'medium',
    entity_type: overrides.entity_type || 'budget_period',
    entity_id: overrides.entity_id || overrides.type || 'entity',
    created_at: overrides.created_at || new Date().toISOString(),
    metadata: overrides.metadata || {},
    ...overrides,
  };
}

describe('insightBuilder orchestration', () => {
  it('classifies insights into portfolio families', () => {
    expect(portfolioFamily(buildInsight({ type: 'projected_month_end_over_budget' }))).toBe('warning');
    expect(portfolioFamily(buildInsight({ type: 'one_off_expense_skewing_projection' }))).toBe('explanation');
    expect(portfolioFamily(buildInsight({ type: 'recurring_restock_window' }))).toBe('opportunity');
    expect(portfolioFamily(buildInsight({ type: 'recurring_repurchase_due' }))).toBe('reminder');
  });

  it('prefers a more diverse final portfolio over multiple similar cards', () => {
    const insights = [
      buildInsight({ id: 'warn-1', type: 'projected_month_end_over_budget', severity: 'high', entity_id: 'budget:1' }),
      buildInsight({ id: 'warn-2', type: 'projected_category_surge', severity: 'high', entity_type: 'category', entity_id: 'cat:groceries' }),
      buildInsight({ id: 'explain-1', type: 'one_off_expense_skewing_projection', severity: 'medium', entity_type: 'expense', entity_id: 'expense:1' }),
      buildInsight({ id: 'opp-1', type: 'recurring_restock_window', severity: 'medium', entity_type: 'item', entity_id: 'item:1' }),
      buildInsight({ id: 'reminder-1', type: 'recurring_repurchase_due', severity: 'medium', entity_type: 'item', entity_id: 'item:2' }),
    ];

    const selected = orchestrateInsightPortfolio(insights, new Map(), 3);
    expect(selected.map((insight) => insight.id)).toEqual(
      expect.arrayContaining(['warn-1', 'explain-1', 'opp-1'])
    );
    expect(selected.map((insight) => insight.id)).not.toEqual(
      expect.arrayContaining(['warn-1', 'warn-2', 'explain-1', 'opp-1'])
    );
  });
});
