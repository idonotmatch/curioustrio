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

  if (type === 'recurring_repurchase_due' && Number(metadata.bundle_item_count || 0) > 1) {
    return {
      next_step_type: 'review_item_bundle',
      reason: 'Shared timing signal',
      title: 'Review the usual basket',
      body: `See why these ${metadata.bundle_item_count} items were grouped, including their shared purchases, usual store, and typical combined cost.`,
      cta: 'Review usual basket',
      route: null,
    };
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    const itemActions = {
      item_recent_price_jump: {
        reason: 'Price moved',
        title: 'Check the price history',
        body: 'Compare the latest purchase with the prior baseline, then open the source expense if the item or amount needs correcting.',
        cta: 'Review price evidence',
      },
      item_merchant_variance: {
        reason: 'Repeated comparison',
        title: 'Compare the merchants',
        body: 'See the sample count and typical price at each merchant before changing where you buy it.',
        cta: 'Compare merchants',
      },
      item_staple_merchant_opportunity: {
        reason: 'Savings opportunity',
        title: 'Compare the merchants',
        body: 'This is becoming a regular purchase, so a repeated price difference may be worth acting on.',
        cta: 'Compare merchants',
      },
      item_repurchase_accelerating: {
        reason: 'Cadence changed',
        title: 'Check the purchase rhythm',
        body: 'Review the purchase dates to confirm whether consumption is actually speeding up or one purchase was unusual.',
        cta: 'Review purchase timing',
      },
      item_pattern_lapsed: {
        reason: 'Pattern changed',
        title: 'Review the missing purchase',
        body: 'Check whether this routine ended, the item changed names, or a recent purchase was matched incorrectly.',
        cta: 'Review item history',
      },
      item_staple_emerging: {
        reason: 'Pattern forming',
        title: 'Review the new routine',
        body: 'See the purchases behind this pattern and decide whether it belongs in your ongoing plan.',
        cta: 'Review item history',
      },
      recurring_repurchase_due: {
        reason: 'Timing signal',
        title: 'Check whether it is actually due',
        body: 'Use the purchase timeline to confirm whether the usual cadence still fits.',
        cta: 'Review purchase timing',
      },
    };
    const itemAction = itemActions[type] || {
      reason: 'Item signal',
      title: 'Review the item detail',
      body: 'Use the item history and recent purchases to decide whether this is worth acting on now.',
      cta: 'Open item detail',
    };
    return {
      next_step_type: 'review_item_detail',
      ...itemAction,
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
      cta: 'Review drivers',
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
      title: 'Check what changed',
      body: 'Look at the supporting expenses before changing plans.',
      cta: 'Review evidence',
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
    cta: 'Review detail',
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
