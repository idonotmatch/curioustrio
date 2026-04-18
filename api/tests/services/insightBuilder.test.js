const {
  portfolioFamily,
  orchestrateInsightPortfolio,
  narrativeClusterKey,
  narrativeTheme,
  buildEarlyUsageInsights,
  buildDevelopingUsageInsights,
  USAGE_INSIGHT_THRESHOLDS,
  summarizeExpenseRows,
  summarizeInsightList,
  tierGateSummary,
  insightContinuityKey,
  scopeAgnosticContinuityKey,
  resolveMaturityCompetition,
  resolveScopeOverlapCompetition,
  buildUsageFallbackInsights,
  shouldSupplementWithUsageFallback,
  determineUsageFallbackScope,
  insightDestinationAdjustment,
  portfolioRole,
  scopeHierarchyAdjustment,
  promoteExplorationCandidate,
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

  it('classifies item-history insights into useful families and clusters', () => {
    expect(portfolioRole(buildInsight({
      type: 'item_staple_merchant_opportunity',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('act');
    expect(portfolioFamily(buildInsight({
      type: 'item_staple_merchant_opportunity',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('opportunity');
    expect(narrativeClusterKey(buildInsight({
      type: 'item_staple_merchant_opportunity',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('recurring:personal:2026-04');
    expect(portfolioFamily(buildInsight({
      type: 'item_merchant_variance',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('opportunity');
    expect(portfolioFamily(buildInsight({
      type: 'item_staple_emerging',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('explanation');
    expect(narrativeClusterKey(buildInsight({
      type: 'item_staple_emerging',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('trend:personal:2026-04');
    expect(narrativeClusterKey(buildInsight({
      type: 'item_merchant_variance',
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBe('recurring:personal:2026-04');
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

  it('gives personal insights a stronger hierarchy boost than household insights', () => {
    expect(scopeHierarchyAdjustment(buildInsight({
      metadata: { scope: 'personal', month: '2026-04' },
    }))).toBeGreaterThan(scopeHierarchyAdjustment(buildInsight({
      metadata: { scope: 'household', month: '2026-04' },
    })));
  });

  it('prefers a personal insight over an equally strong household insight', () => {
    const selected = orchestrateInsightPortfolio([
      buildInsight({
        id: 'household-explain',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: { scope: 'household', month: '2026-04', category_key: 'groceries' },
      }),
      buildInsight({
        id: 'personal-explain',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: { scope: 'personal', month: '2026-04', category_key: 'dining' },
      }),
    ], new Map(), 1);

    expect(selected[0].id).toBe('personal-explain');
  });

  it('promotes one low-history insight type into the candidate window to keep learning fresh', () => {
    const ranked = [
      buildInsight({ id: 'known-1', type: 'projected_month_end_over_budget' }),
      buildInsight({ id: 'known-2', type: 'top_category_driver' }),
      buildInsight({ id: 'known-3', type: 'item_merchant_variance' }),
      buildInsight({ id: 'new-1', type: 'buy_soon_better_price' }),
    ];

    const reordered = promoteExplorationCandidate(ranked, {
      type_preferences: [
        { key: 'projected_month_end_over_budget', shown: 4, score: 1 },
        { key: 'top_category_driver', shown: 5, score: 0.5 },
        { key: 'item_merchant_variance', shown: 3, score: 0.5 },
      ],
    }, 3);

    expect(reordered.slice(0, 3).map((insight) => insight.id)).toEqual(['known-1', 'known-2', 'new-1']);
  });

  it('does not reshuffle the window when a low-history type is already present', () => {
    const ranked = [
      buildInsight({ id: 'known-1', type: 'projected_month_end_over_budget' }),
      buildInsight({ id: 'new-1', type: 'buy_soon_better_price' }),
      buildInsight({ id: 'known-2', type: 'top_category_driver' }),
      buildInsight({ id: 'known-3', type: 'item_merchant_variance' }),
    ];

    const reordered = promoteExplorationCandidate(ranked, {
      type_preferences: [
        { key: 'projected_month_end_over_budget', shown: 4, score: 1 },
        { key: 'top_category_driver', shown: 5, score: 0.5 },
        { key: 'item_merchant_variance', shown: 3, score: 0.5 },
      ],
    }, 3);

    expect(reordered).toEqual(ranked);
  });

  it('annotates household-only insights as rollups from personal activity', () => {
    const resolved = resolveScopeOverlapCompetition([
      buildInsight({
        id: 'household-only',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: { scope: 'household', month: '2026-04', category_key: 'groceries' },
      }),
    ]);

    expect(resolved[0].metadata.scope_origin).toBe('household');
    expect(resolved[0].metadata.rolls_up_from_personal).toBe(true);
    expect(resolved[0].metadata.household_context_included).toBe(true);
    expect(resolved[0].metadata.hierarchy_level).toBe('household_rollup');
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

  it('prefers the lineage variant with stronger portfolio feedback history', () => {
    const feedbackSummary = new Map([
      ['top_category_driver', {
        shown: 2,
        helpful: 0,
        not_helpful: 0,
        dismissed: 0,
        acted: 0,
        reasons: {},
        outcomes: {},
        reviews: {},
        lineage: {
          personal: {
            shown: 3,
            helpful: 2,
            not_helpful: 0,
            dismissed: 0,
            acted: 1,
            reasons: {},
            outcomes: {},
            reviews: {},
          },
          household_rollup: {
            shown: 3,
            helpful: 0,
            not_helpful: 2,
            dismissed: 1,
            acted: 0,
            reasons: {},
            outcomes: {},
            reviews: {},
          },
        },
        last_negative_at: null,
        last_helpful_at: null,
        last_acted_at: null,
      }],
    ]);

    const selected = orchestrateInsightPortfolio([
      buildInsight({
        id: 'household-driver',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: {
          scope: 'household',
          month: '2026-04',
          category_key: 'groceries',
          hierarchy_level: 'household_rollup',
          scope_origin: 'household',
          rolls_up_from_personal: true,
        },
      }),
      buildInsight({
        id: 'personal-driver',
        type: 'top_category_driver',
        severity: 'medium',
        metadata: {
          scope: 'personal',
          month: '2026-04',
          category_key: 'dining',
          hierarchy_level: 'personal',
          scope_origin: 'personal',
          rolls_up_from_personal: false,
        },
      }),
    ], feedbackSummary, 1);

    expect(selected[0].id).toBe('personal-driver');
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
    expect(insights[0].metadata.scope_origin).toBe('personal');
    expect(insights[0].metadata.rolls_up_from_personal).toBe(false);
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

  it('builds descriptive early insights before mature history exists', () => {
    const insights = buildEarlyUsageInsights({
      projection: {
        month: '2026-04',
        period: { day_index: 7, days_in_period: 30 },
        overall: {
          current_spend_to_date: 170,
          historical_period_count: 0,
          history_stage: 'none',
        },
        current_activity: {
          expense_count: 6,
          active_day_count: 4,
          total_spend: 170,
          top_categories: [
            { category_key: 'shopping', category_name: 'Shopping', spend: 95, count: 3 },
            { category_key: 'dining', category_name: 'Dining', spend: 45, count: 2 },
          ],
          top_merchants: [
            { merchant_key: 'amazon', merchant_name: 'Amazon', spend: 70, count: 2 },
          ],
          largest_expense: {
            id: 'expense-1',
            merchant: 'Amazon',
            amount: 70,
            date: '2026-04-04',
            category_key: 'shopping',
            category_name: 'Shopping',
            share_of_spend: 0.4118,
          },
          uncategorized_count: 2,
        },
      },
      budgetLimit: 500,
      scope: 'personal',
    });

    expect(insights.map((insight) => insight.type)).toEqual(expect.arrayContaining([
      'early_budget_pace',
      'early_top_category',
      'early_repeated_merchant',
      'early_spend_concentration',
    ]));
    expect(insights.every((insight) => insight.metadata.maturity === 'early')).toBe(true);
    expect(insights.every((insight) => insight.metadata.confidence === 'descriptive')).toBe(true);
  });

  it('builds lightweight early insights from sparse first-week activity', () => {
    const insights = buildEarlyUsageInsights({
      projection: {
        month: '2026-04',
        period: { day_index: 3, days_in_period: 30 },
        overall: {
          current_spend_to_date: 50,
          historical_period_count: 0,
          history_stage: 'none',
        },
        current_activity: {
          expense_count: 2,
          active_day_count: 2,
          total_spend: 50,
          top_categories: [
            { category_key: 'shopping', category_name: 'Shopping', spend: 32, count: 2 },
          ],
          top_merchants: [
            { merchant_key: 'amazon', merchant_name: 'Amazon', spend: 32, count: 2 },
          ],
          largest_expense: {
            id: 'expense-1',
            merchant: 'Amazon',
            amount: 22,
            date: '2026-04-02',
            category_key: 'shopping',
            category_name: 'Shopping',
            share_of_spend: 0.44,
          },
          uncategorized_count: 0,
        },
      },
      budgetLimit: 500,
      scope: 'personal',
    });

    expect(USAGE_INSIGHT_THRESHOLDS.earlyTopCategory.minExpenseCount).toBe(2);
    expect(insights.map((insight) => insight.type)).toEqual(expect.arrayContaining([
      'early_budget_pace',
      'early_top_category',
      'early_repeated_merchant',
      'early_spend_concentration',
    ]));
  });

  it('does not build early insights once mature history exists', () => {
    const insights = buildEarlyUsageInsights({
      projection: {
        month: '2026-04',
        overall: {
          current_spend_to_date: 170,
          historical_period_count: 3,
          history_stage: 'developing',
        },
        current_activity: {
          expense_count: 6,
          active_day_count: 4,
          total_spend: 170,
        },
      },
      budgetLimit: 500,
      scope: 'personal',
    });

    expect(insights).toEqual([]);
  });

  it('summarizes expense rows for rolling developing insights', () => {
    const summary = summarizeExpenseRows([
      { merchant: 'Amazon', amount: 40, date: '2026-04-02', category_key: 'shopping', category_name: 'Shopping' },
      { merchant: 'Amazon', amount: 20, date: '2026-04-03', category_key: 'shopping', category_name: 'Shopping' },
      { merchant: 'Cafe', amount: 12, date: '2026-04-03', category_key: 'dining', category_name: 'Dining' },
    ]);

    expect(summary).toMatchObject({
      expense_count: 3,
      active_day_count: 2,
      total_spend: 72,
    });
    expect(summary.top_merchants[0]).toMatchObject({ merchant_key: 'amazon', count: 2, spend: 60 });
  });

  it('summarizes insight lists for debug output', () => {
    const summary = summarizeInsightList([
      buildInsight({ id: 'early-1', type: 'early_top_category', severity: 'low', metadata: { maturity: 'early' } }),
      buildInsight({ id: 'developing-1', type: 'developing_category_shift', severity: 'medium', metadata: { maturity: 'developing' } }),
      buildInsight({ id: 'mature-1', type: 'projected_category_surge', severity: 'high', metadata: { maturity: 'mature' } }),
    ]);

    expect(summary.count).toBe(3);
    expect(summary.by_maturity).toMatchObject({ early: 1, developing: 1, mature: 1 });
    expect(summary.by_type.projected_category_surge).toBe(1);
    expect(summary.ids).toEqual(['early-1', 'developing-1', 'mature-1']);
  });

  it('explains tier gates for early, developing, and mature insight readiness', () => {
    const gates = tierGateSummary({
      projection: {
        overall: {
          history_stage: 'none',
          historical_period_count: 0,
          current_spend_to_date: 150,
        },
        current_activity: {
          expense_count: 6,
          active_day_count: 4,
          total_spend: 150,
          top_categories: [{ category_key: 'shopping', category_name: 'Shopping', spend: 80, count: 3 }],
          top_merchants: [{ merchant_key: 'amazon', merchant_name: 'Amazon', spend: 60, count: 2 }],
          uncategorized_count: 1,
        },
      },
      rollingActivity: {
        days: 7,
        current_window: {
          expense_count: 6,
          active_day_count: 4,
          total_spend: 150,
        },
        previous_window: {
          total_spend: 90,
        },
      },
      budgetLimit: 500,
    });

    expect(gates.budget_set).toBe(true);
    expect(gates.gates.early.eligible).toBe(true);
    expect(gates.gates.developing.eligible).toBe(true);
    expect(gates.gates.mature.eligible).toBe(false);
    expect(gates.gates.mature.blocked_by).toEqual(['historical_period_count_lt_3']);
  });

  it('builds directional developing insights from rolling windows', () => {
    const insights = buildDevelopingUsageInsights({
      rollingActivity: {
        scope: 'personal',
        days: 7,
        current_window: {
          from: '2026-04-04',
          to: '2026-04-11',
          expense_count: 6,
          active_day_count: 4,
          total_spend: 185,
          top_categories: [
            { category_key: 'shopping', category_name: 'Shopping', spend: 110, count: 3 },
          ],
          top_merchants: [
            { merchant_key: 'amazon', merchant_name: 'Amazon', spend: 80, count: 2 },
          ],
        },
        previous_window: {
          from: '2026-03-28',
          to: '2026-04-04',
          expense_count: 4,
          active_day_count: 3,
          total_spend: 90,
          top_categories: [
            { category_key: 'shopping', category_name: 'Shopping', spend: 25, count: 1 },
          ],
          top_merchants: [
            { merchant_key: 'cafe', merchant_name: 'Cafe', spend: 30, count: 2 },
          ],
        },
      },
      projection: {
        overall: {
          historical_period_count: 0,
        },
      },
      scope: 'personal',
    });

    expect(insights.map((insight) => insight.type)).toEqual(expect.arrayContaining([
      'developing_weekly_spend_change',
      'developing_category_shift',
      'developing_repeated_merchant',
    ]));
    expect(insights.every((insight) => insight.metadata.maturity === 'developing')).toBe(true);
    expect(insights.every((insight) => insight.metadata.confidence === 'directional')).toBe(true);
  });

  it('opens developing insights with three rolling expenses across two days', () => {
    const gates = tierGateSummary({
      projection: {
        overall: {
          history_stage: 'none',
          historical_period_count: 0,
          current_spend_to_date: 80,
        },
        current_activity: {
          expense_count: 3,
          active_day_count: 2,
          total_spend: 80,
        },
      },
      rollingActivity: {
        days: 7,
        current_window: {
          expense_count: 3,
          active_day_count: 2,
          total_spend: 80,
        },
        previous_window: {
          total_spend: 45,
        },
      },
      budgetLimit: 500,
    });

    expect(USAGE_INSIGHT_THRESHOLDS.developing.minExpenseCount).toBe(3);
    expect(gates.gates.developing.eligible).toBe(true);
  });

  it('uses continuity keys to connect early, developing, and mature category cards', () => {
    expect(insightContinuityKey(buildInsight({
      type: 'early_top_category',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'early', category_key: 'shopping' },
    }))).toBe('category:personal:shopping');

    expect(insightContinuityKey(buildInsight({
      type: 'projected_category_surge',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'mature', category_key: 'shopping' },
    }))).toBe('category:personal:shopping');
  });

  it('uses scope-agnostic continuity keys to spot personal and household overlap', () => {
    expect(scopeAgnosticContinuityKey(buildInsight({
      type: 'early_top_category',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'early', category_key: 'shopping' },
    }))).toBe('category:shared:shopping');

    expect(scopeAgnosticContinuityKey(buildInsight({
      type: 'developing_category_shift',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'household', maturity: 'developing', category_key: 'shopping' },
    }))).toBe('category:shared:shopping');
  });

  it('graduates a story by keeping the most mature insight for a continuity key', () => {
    const early = buildInsight({
      id: 'early-shopping',
      type: 'early_top_category',
      severity: 'medium',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'early', category_key: 'shopping' },
    });
    const developing = buildInsight({
      id: 'developing-shopping',
      type: 'developing_category_shift',
      severity: 'low',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'developing', category_key: 'shopping' },
    });
    const mature = buildInsight({
      id: 'mature-shopping',
      type: 'projected_category_surge',
      severity: 'low',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'mature', category_key: 'shopping' },
    });

    const resolved = resolveMaturityCompetition([early, developing, mature]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe('mature-shopping');
  });

  it('consolidates overlapping personal and household driver cards', () => {
    const personal = buildInsight({
      id: 'personal-shopping',
      type: 'developing_category_shift',
      title: 'Shopping is becoming your week center',
      body: 'Shopping is 48% of your personal spending over the last 7 days.',
      severity: 'medium',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'personal', maturity: 'developing', category_key: 'shopping', category_name: 'Shopping' },
    });
    const household = buildInsight({
      id: 'household-shopping',
      type: 'developing_category_shift',
      title: 'Shopping is becoming the household week center',
      body: 'Shopping is 45% of your household spending over the last 7 days.',
      severity: 'medium',
      entity_type: 'category',
      entity_id: 'shopping',
      metadata: { scope: 'household', maturity: 'developing', category_key: 'shopping', category_name: 'Shopping' },
    });

    const resolved = resolveScopeOverlapCompetition([personal, household]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].metadata.scope).toBe('personal');
    expect(resolved[0].metadata.scope_relationship).toBe('personal_household_overlap');
    expect(resolved[0].metadata.consolidated_scopes).toEqual(['personal', 'household']);
    expect(resolved[0].metadata.related_insight_ids).toEqual(['household-shopping']);
    expect(resolved[0].metadata.scope_origin).toBe('personal');
    expect(resolved[0].metadata.rolls_up_from_personal).toBe(true);
    expect(resolved[0].metadata.household_context_included).toBe(true);
    expect(resolved[0].metadata.hierarchy_level).toBe('personal_with_household_context');
    expect(resolved[0].metadata.consolidated_from[0].scope_origin).toBe('personal');
    expect(resolved[0].metadata.consolidated_from[1].scope_origin).toBe('household');
    expect(resolved[0].title).toBe('Shopping is showing up in your spending and rolling into the household');
    expect(resolved[0].body).toContain('starts with your pattern');
  });

  it('does not consolidate unrelated personal and household cards', () => {
    const resolved = resolveScopeOverlapCompetition([
      buildInsight({
        id: 'personal-shopping',
        type: 'developing_category_shift',
        entity_type: 'category',
        entity_id: 'shopping',
        metadata: { scope: 'personal', maturity: 'developing', category_key: 'shopping' },
      }),
      buildInsight({
        id: 'household-dining',
        type: 'developing_category_shift',
        entity_type: 'category',
        entity_id: 'dining',
        metadata: { scope: 'household', maturity: 'developing', category_key: 'dining' },
      }),
    ]);

    expect(resolved).toHaveLength(2);
  });

  it('does not build developing insights once mature history exists', () => {
    const insights = buildDevelopingUsageInsights({
      rollingActivity: {
        scope: 'personal',
        days: 7,
        current_window: {
          from: '2026-04-04',
          to: '2026-04-11',
          expense_count: 6,
          active_day_count: 4,
          total_spend: 185,
          top_categories: [{ category_key: 'shopping', category_name: 'Shopping', spend: 110, count: 3 }],
          top_merchants: [{ merchant_key: 'amazon', merchant_name: 'Amazon', spend: 80, count: 2 }],
        },
        previous_window: {
          from: '2026-03-28',
          to: '2026-04-04',
          expense_count: 4,
          active_day_count: 3,
          total_spend: 90,
          top_categories: [],
          top_merchants: [],
        },
      },
      projection: {
        overall: {
          historical_period_count: 3,
        },
      },
      scope: 'personal',
    });

    expect(insights).toEqual([]);
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

  it('defaults quiet-period fallback scope to personal for solo users', () => {
    const scope = determineUsageFallbackScope([
      buildInsight({
        id: 'explain-1',
        type: 'spend_pace_behind',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ], { id: 'user-1', household_id: null });

    expect(scope).toBe('personal');
  });

  it('keeps fallback scope personal when any personal signal exists', () => {
    const scope = determineUsageFallbackScope([
      buildInsight({
        id: 'explain-1',
        type: 'spend_pace_behind',
        severity: 'low',
        metadata: { scope: 'household', month: '2026-04' },
      }),
      buildInsight({
        id: 'explain-2',
        type: 'budget_too_high',
        severity: 'low',
        metadata: { scope: 'household', month: '2026-04' },
      }),
      buildInsight({
        id: 'explain-3',
        type: 'spend_pace_behind',
        severity: 'low',
        metadata: { scope: 'personal', month: '2026-04' },
      }),
    ], { id: 'user-1', household_id: 'household-1' });

    expect(scope).toBe('personal');
  });

  it('uses household fallback scope only when there are no personal signals at all', () => {
    const scope = determineUsageFallbackScope([
      buildInsight({
        id: 'explain-1',
        type: 'spend_pace_behind',
        severity: 'low',
        metadata: { scope: 'household', month: '2026-04' },
      }),
      buildInsight({
        id: 'explain-2',
        type: 'budget_too_high',
        severity: 'low',
        metadata: { scope: 'household', month: '2026-04' },
      }),
    ], { id: 'user-1', household_id: 'household-1' });

    expect(scope).toBe('household');
  });
});
