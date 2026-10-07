const { buildInsightAction, attachInsightAction } = require('../../src/services/insightAction');

describe('insightAction', () => {
  it('builds planner actions for ready-to-plan insights', () => {
    const action = buildInsightAction({
      id: 'insight-1',
      type: 'usage_ready_to_plan',
      metadata: {
        scope: 'personal',
        month: '2026-04',
        planning_confidence: 'directional',
      },
    });

    expect(action).toMatchObject({
      next_step_type: 'plan_purchase',
      cta: 'Open planner',
      route: {
        pathname: '/scenario-check',
        params: {
          scope: 'personal',
          month: '2026-04',
        },
      },
    });
  });

  it('builds item-detail actions for item insights', () => {
    const action = buildInsightAction({
      id: 'insight-2',
      type: 'item_recent_price_jump',
      title: 'Greek Yogurt cost more than usual',
      body: 'Recent price was higher.',
      entity_type: 'item',
      metadata: {
        scope: 'personal',
        group_key: 'comparable:greek-yogurt',
        item_name: 'Greek Yogurt',
      },
    });

    expect(action).toMatchObject({
      next_step_type: 'review_item_detail',
      reason: 'Price moved',
      cta: 'Review price evidence',
      route: {
        pathname: '/recurring-item',
        params: {
          group_key: 'comparable:greek-yogurt',
          title: 'Greek Yogurt',
        },
      },
    });
  });

  it('gives lapsed item patterns a correction-oriented action', () => {
    const action = buildInsightAction({
      id: 'insight-lapsed',
      type: 'item_pattern_lapsed',
      entity_type: 'item',
      metadata: { group_key: 'product:paper-towels', scope: 'household', item_name: 'Paper Towels' },
    });

    expect(action).toMatchObject({
      reason: 'Pattern changed',
      cta: 'Review item history',
      route: { pathname: '/recurring-item' },
    });
    expect(action.body).toContain('matched incorrectly');
  });

  it('explains why aligned recurring items were grouped', () => {
    const action = buildInsightAction({
      id: 'bundle-1',
      type: 'recurring_repurchase_due',
      entity_type: 'item_bundle',
      metadata: { bundle_item_count: 3, usual_merchant: 'Market' },
    });

    expect(action).toMatchObject({
      next_step_type: 'review_item_bundle',
      reason: 'Shared timing signal',
      cta: 'Review usual basket',
      route: null,
    });
    expect(action.body).toContain('shared purchases');
  });

  it('links a known one-off signal directly to its source expense', () => {
    const action = buildInsightAction({
      id: 'one-off-1',
      type: 'one_off_expense_skewing_projection',
      metadata: {
        top_unusual_expense: { id: 'expense-123', merchant: 'Market', amount: 225 },
      },
    });

    expect(action).toMatchObject({
      next_step_type: 'review_source_expense',
      cta: 'Review source expense',
      route: {
        pathname: '/expense/[id]',
        params: { id: 'expense-123' },
      },
    });
  });

  it('provides a named next step for every emitted insight type', () => {
    const insightTypes = [
      'usage_start_logging', 'usage_set_budget', 'usage_building_history', 'usage_ready_to_plan',
      'early_budget_pace', 'early_top_category', 'early_repeated_merchant', 'early_spend_concentration',
      'early_cleanup', 'early_logging_momentum', 'developing_weekly_spend_change',
      'developing_category_shift', 'developing_repeated_merchant', 'spend_pace_ahead',
      'spend_pace_behind', 'budget_too_low', 'budget_too_high', 'top_category_driver',
      'one_offs_driving_variance', 'projected_month_end_over_budget',
      'projected_month_end_under_budget', 'one_off_expense_skewing_projection',
      'projected_category_surge', 'projected_category_under_baseline', 'recurring_cost_pressure',
      'recurring_repurchase_due', 'recurring_restock_window', 'buy_soon_better_price',
      'item_merchant_variance', 'item_pattern_lapsed', 'item_recent_price_jump',
      'item_repurchase_accelerating', 'item_staple_emerging', 'item_staple_merchant_opportunity',
      'recurring_price_spike', 'recurring_better_than_usual', 'recurring_cheaper_elsewhere',
    ];

    for (const type of insightTypes) {
      const isItem = type.startsWith('item_')
        || type.startsWith('recurring_')
        || type === 'buy_soon_better_price';
      const action = buildInsightAction({
        id: `insight-${type}`,
        type,
        title: 'Insight title',
        entity_type: isItem && type !== 'recurring_cost_pressure' ? 'item' : null,
        metadata: {
          scope: 'personal',
          month: '2026-09',
          group_key: isItem && type !== 'recurring_cost_pressure' ? `product:${type}` : null,
        },
      });

      expect(action.next_step_type).toEqual(expect.any(String));
      expect(action.title).toEqual(expect.any(String));
      expect(action.body).toEqual(expect.any(String));
      expect(action.cta).toEqual(expect.any(String));
    }
  });

  it('attaches action metadata to an insight', () => {
    const insight = attachInsightAction({
      id: 'insight-3',
      type: 'early_cleanup',
      title: 'A few expenses still need categories',
      metadata: {},
    });

    expect(insight.action).toMatchObject({
      next_step_type: 'clean_up_categories',
      cta: 'Open categories',
    });
  });
});
