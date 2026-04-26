function buildInsightAction(insight) {
  const type = `${insight?.type || ''}`.trim();
  const metadata = insight?.metadata || {};
  const scope = metadata.scope || 'personal';
  const month = metadata.month || '';

  if (type === 'usage_start_logging' || type === 'usage_building_history') {
    return {
      next_step_type: 'log_expense',
      reason: 'Build the baseline',
      title: 'Log a few more expenses',
      body: 'A little more activity will make the next set of insights more specific and more useful.',
      cta: 'Log expense',
      route: { pathname: '/(tabs)/add', params: {} },
    };
  }

  if (type === 'usage_set_budget') {
    return {
      next_step_type: 'set_budget',
      reason: 'Needs setup',
      title: 'Set the budget baseline',
      body: 'A budget target gives Adlo something concrete to compare your spending against.',
      cta: 'Set budget',
      route: { pathname: '/budget-period', params: {} },
    };
  }

  if (type === 'usage_ready_to_plan') {
    return {
      next_step_type: 'plan_purchase',
      reason: metadata?.planning_confidence === 'directional' ? 'Directional read' : 'Ready to plan',
      title: 'Pressure-test the purchase',
      body: metadata?.planning_confidence === 'directional'
        ? 'Start with a smaller what-if first, then compare timing before treating the room as fully reliable.'
        : 'Compare whether this fits better now, next period, or spread across a few periods.',
      cta: 'Open planner',
      route: { pathname: '/scenario-check', params: { scope, month } },
    };
  }

  if (type === 'early_cleanup') {
    return {
      next_step_type: 'clean_up_categories',
      reason: 'Improve future reads',
      title: 'Clean up the inputs first',
      body: 'Fixing uncategorized or shaky expenses is the fastest way to make future insight cards more specific.',
      cta: 'Open categories',
      route: { pathname: '/categories', params: {} },
    };
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    return {
      next_step_type: 'review_item_detail',
      reason: 'Item signal',
      title: 'Review the item detail',
      body: 'Use the item history and recent purchases to decide whether this is worth acting on now.',
      cta: 'Open item detail',
      route: {
        pathname: '/recurring-item',
        params: {
          group_key: metadata.group_key,
          scope,
          title: metadata.item_name || insight.title,
          insight_id: insight.id,
          insight_type: insight.type,
          body: insight.body,
        },
      },
    };
  }

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'budget_too_low'
    || type === 'budget_too_high'
    || type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'recurring_cost_pressure'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'one_off_expense_skewing_projection'
    || type === 'projected_category_surge'
  ) {
    return {
      next_step_type: 'review_trend_detail',
      reason: 'Needs context',
      title: 'Read the driver first',
      body: 'Use the breakdown to see whether this is broad pressure, one unusual purchase, or a category shift.',
      cta: 'Open detail',
      route: {
        pathname: '/trend-detail',
        params: {
          scope,
          month,
          insight_type: insight.type,
          category_key: metadata.category_key || '',
          title: insight.title,
          insight_id: insight.id,
        },
      },
    };
  }

  if (
    type.startsWith('early_')
    || type.startsWith('developing_')
  ) {
    return {
      next_step_type: 'review_insight_detail',
      reason: 'Early signal',
      title: 'Read the signal in context',
      body: 'This is an early read, so the most useful next step is understanding the pattern before reacting too hard.',
      cta: 'Open detail',
      route: {
        pathname: '/insight-detail',
        params: {
          insight_id: insight.id,
          insight_type: insight.type,
          title: insight.title,
          body: insight.body,
          severity: insight.severity || 'low',
          entity_type: insight.entity_type || '',
          entity_id: insight.entity_id || '',
        },
      },
    };
  }

  return {
    next_step_type: 'review_detail',
    reason: 'Needs context',
    title: 'Review the detail',
    body: 'Open the supporting detail before deciding whether this is worth acting on.',
    cta: 'Open detail',
    route: null,
  };
}

function attachInsightAction(insight) {
  if (!insight) return insight;
  return {
    ...insight,
    action: buildInsightAction(insight),
  };
}

module.exports = {
  buildInsightAction,
  attachInsightAction,
};
