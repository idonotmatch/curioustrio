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
      route: {
        pathname: '/recurring-item',
        params: {
          group_key: 'comparable:greek-yogurt',
          title: 'Greek Yogurt',
        },
      },
    });
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
