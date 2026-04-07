const {
  portfolioFamily,
  orchestrateInsightPortfolio,
  narrativeClusterKey,
  narrativeTheme,
  buildUsageFallbackInsights,
  shouldSupplementWithUsageFallback,
  insightDestinationAdjustment,
  portfolioRole,
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

  it('classifies insights into portfolio roles', () => {
    expect(portfolioRole(buildInsight({ type: 'usage_set_budget' }))).toBe('setup');
    expect(portfolioRole(buildInsight({ type: 'projected_month_end_over_budget' }))).toBe('act');
    expect(portfolioRole(buildInsight({ type: 'projected_month_end_under_budget' }))).toBe('plan');
    expect(portfolioRole(buildInsight({ type: 'top_category_driver' }))).toBe('explain');
  });

  it('groups related insights into narrative clusters', () => {
    expect(narrativeClusterKey(buildInsight({
      type: 'spend_pace_ahead',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('trend:personal:2026-04');
    expect(narrativeClusterKey(buildInsight({
      type: 'projected_category_surge',
      metadata: { scope: 'household', month: '2026-04' },
    }))).toBe('projection:household:2026-04');
    expect(narrativeClusterKey(buildInsight({
      type: 'recurring_restock_window',
      metadata: { scope: 'household', month: '2026-04' },
    }))).toBe('recurring:household:2026-04');
    expect(narrativeTheme(buildInsight({
      type: 'projected_month_end_under_budget',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('projection');
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

  it('avoids stacking multiple cards from the same narrative cluster too early', () => {
    const insights = [
      buildInsight({ id: 'trend-1', type: 'spend_pace_ahead', severity: 'high', metadata: { scope: 'personal', month: '2026-04' } }),
      buildInsight({ id: 'trend-2', type: 'top_category_driver', severity: 'medium', metadata: { scope: 'personal', month: '2026-04' } }),
      buildInsight({ id: 'projection-1', type: 'projected_month_end_over_budget', severity: 'high', metadata: { scope: 'personal', month: '2026-04' } }),
      buildInsight({ id: 'recurring-1', type: 'recurring_repurchase_due', severity: 'medium', metadata: { scope: 'household', month: '2026-04' } }),
    ];

    const selected = orchestrateInsightPortfolio(insights, new Map(), 3);
    expect(selected.map((insight) => insight.id)).toContain('trend-2');
    expect(selected.map((insight) => insight.id)).toContain('projection-1');
    expect(selected.map((insight) => insight.id)).toContain('recurring-1');
    expect(selected.map((insight) => insight.id)).not.toContain('trend-1');
  });

  it('prefers the card with the stronger destination when similar cards compete', () => {
    const insights = [
      buildInsight({
        id: 'pace-1',
        type: 'spend_pace_ahead',
        severity: 'high',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
      buildInsight({
        id: 'category-1',
        type: 'top_category_driver',
        severity: 'high',
        metadata: { scope: 'personal', month: '2026-04', category_key: 'groceries' },
      }),
    ];

    expect(insightDestinationAdjustment(insights[1])).toBeGreaterThan(insightDestinationAdjustment(insights[0]));
    const selected = orchestrateInsightPortfolio(insights, new Map(), 1);
    expect(selected[0].id).toBe('category-1');
  });

  it('keeps explanation cards from crowding out setup/action cards too early', () => {
    const insights = [
      buildInsight({
        id: 'explain-1',
        type: 'top_category_driver',
        severity: 'high',
        metadata: { scope: 'personal', month: '2026-04', category_key: 'groceries' },
      }),
      buildInsight({
        id: 'explain-2',
        type: 'one_offs_driving_variance',
        severity: 'high',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
      buildInsight({
        id: 'setup-1',
        type: 'usage_set_budget',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ];

    const selected = orchestrateInsightPortfolio(insights, new Map(), 2);
    expect(selected.map((insight) => insight.id)).toContain('setup-1');
    expect(selected.filter((insight) => portfolioRole(insight) === 'explain')).toHaveLength(1);
  });

  it('boosts families and themes that have stronger acted history', () => {
    const feedbackSummary = new Map([
      ['recurring_restock_window', {
        shown: 6, helpful: 2, not_helpful: 0, dismissed: 0, acted: 3,
        reasons: {}, outcomes: {}, tapped: 0, last_negative_at: null, last_helpful_at: null, last_acted_at: null,
      }],
      ['projected_month_end_over_budget', {
        shown: 6, helpful: 0, not_helpful: 2, dismissed: 2, acted: 0,
        reasons: {}, outcomes: {}, tapped: 0, last_negative_at: null, last_helpful_at: null, last_acted_at: null,
      }],
    ]);

    const insights = [
      buildInsight({ id: 'warning-1', type: 'projected_month_end_over_budget', severity: 'medium', metadata: { scope: 'personal', month: '2026-04' } }),
      buildInsight({ id: 'opp-1', type: 'recurring_restock_window', severity: 'medium', metadata: { scope: 'household', month: '2026-04' } }),
    ];

    const selected = orchestrateInsightPortfolio(insights, feedbackSummary, 1);
    expect(selected[0].id).toBe('opp-1');
  });

  it('builds a budget setup usage fallback when spending exists but no budget is set', () => {
    const insights = buildUsageFallbackInsights({
      user: { id: 'user-1' },
      projection: {
        month: '2026-04',
        overall: {
          current_spend_to_date: 120,
          historical_period_count: 0,
        },
      },
      budgetLimit: null,
      scope: 'personal',
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('usage_set_budget');
  });

  it('builds a planning readiness usage fallback once enough history exists', () => {
    const insights = buildUsageFallbackInsights({
      user: { id: 'user-1' },
      projection: {
        month: '2026-04',
        overall: {
          current_spend_to_date: 120,
          historical_period_count: 4,
        },
      },
      budgetLimit: 500,
      scope: 'personal',
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('usage_ready_to_plan');
  });

  it('builds quiet-period fallback copy when supplementing a thin rail', () => {
    const insights = buildUsageFallbackInsights({
      user: { id: 'user-1' },
      projection: {
        month: '2026-04',
        overall: {
          current_spend_to_date: 120,
          historical_period_count: 4,
        },
      },
      budgetLimit: 500,
      scope: 'personal',
      context: 'quiet_period',
    });

    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe('usage_ready_to_plan');
    expect(insights[0].title).toBe('Quiet month, good time to plan ahead');
    expect(insights[0].metadata.usage_context).toBe('quiet_period');
  });

  it('supplements low-signal explanatory rails with a usage fallback candidate', () => {
    const insights = [
      buildInsight({
        id: 'explain-1',
        type: 'spend_pace_behind',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ];

    expect(shouldSupplementWithUsageFallback(insights)).toBe(true);
  });

  it('does not supplement when a stronger medium-or-high signal is already present', () => {
    const insights = [
      buildInsight({
        id: 'explain-1',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: { scope: 'personal', month: '2026-04', category_key: 'groceries' },
      }),
    ];

    expect(shouldSupplementWithUsageFallback(insights)).toBe(false);
  });

  it('does not supplement when a direct setup, plan, or action card already exists', () => {
    expect(shouldSupplementWithUsageFallback([
      buildInsight({
        id: 'setup-1',
        type: 'usage_set_budget',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ])).toBe(false);

    expect(shouldSupplementWithUsageFallback([
      buildInsight({
        id: 'plan-1',
        type: 'projected_month_end_under_budget',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ])).toBe(false);

    expect(shouldSupplementWithUsageFallback([
      buildInsight({
        id: 'act-1',
        type: 'projected_month_end_over_budget',
        severity: 'high',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ])).toBe(false);
  });
});
