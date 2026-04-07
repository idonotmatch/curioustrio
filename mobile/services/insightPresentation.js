export function getInsightActionDescriptor(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};
  const trend = context.trend || null;
  const categoryKey = `${metadata.category_key || context.categoryKey || ''}`;

  const budgetDelta = Math.abs(Number(
    metadata?.projected_budget_delta
    ?? trend?.budget_adherence?.projected_over_under
    ?? trend?.projection?.overall?.projected_budget_delta
    ?? 0
  ));
  const headroom = Math.abs(Number(
    metadata?.projected_headroom_amount
    ?? 0
  ));
  const historicalCount = Number(
    metadata?.historical_period_count
    ?? trend?.projection?.overall?.historical_period_count
    ?? 0
  );
  const categoryDelta = Math.abs(Number(
    metadata?.delta_amount
    ?? trend?.pace?.top_drivers?.find((driver) => driver.category_key === categoryKey)?.delta_amount
    ?? 0
  ));
  const oneOffDelta = Math.abs(Number(
    metadata?.one_off_delta_amount
    ?? trend?.pace?.variance_breakdown?.one_off_delta_amount
    ?? 0
  ));
  const recurringDelta = Math.abs(Number(
    metadata?.total_delta_amount
    ?? trend?.pace?.variance_breakdown?.recurring_delta_amount
    ?? 0
  ));

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    return { label: 'Review recurring details', reason: 'Actionable now' };
  }

  switch (type) {
    case 'usage_start_logging':
      return { label: "Don't forget to log", reason: metadata?.usage_context === 'quiet_period' ? 'Quiet month' : 'Getting started' };
    case 'usage_set_budget':
      return { label: 'Set your budget', reason: metadata?.usage_context === 'quiet_period' ? 'Good time to set up' : 'Needs setup' };
    case 'usage_building_history':
      return { label: "Don't forget to log", reason: metadata?.usage_context === 'quiet_period' ? 'Quiet month' : 'History building' };
    case 'usage_ready_to_plan':
      return { label: 'Try planning ahead', reason: metadata?.usage_context === 'quiet_period' ? 'Good time to plan' : 'Ready to use' };
    case 'spend_pace_ahead':
      return { label: 'See what is driving it', reason: historicalCount > 0 && historicalCount < 3 ? 'Low confidence' : 'Worth checking' };
    case 'spend_pace_behind':
      return { label: 'See what is driving it', reason: 'Worth checking' };
    case 'budget_too_low':
    case 'projected_month_end_over_budget':
      return {
        label: budgetDelta >= 100 ? 'Pressure-test a purchase' : 'See the budget impact',
        reason: budgetDelta >= 100 ? 'Tight month' : 'Worth checking',
      };
    case 'budget_too_high':
      return { label: 'Review your budget fit', reason: 'Worth checking' };
    case 'projected_month_end_under_budget':
      return {
        label: headroom >= 100 ? 'Try planning ahead' : 'See the budget impact',
        reason: headroom >= 100 ? 'Room available' : 'Worth checking',
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        label: 'Review unusual purchases',
        reason: oneOffDelta >= 75 ? 'Worth checking' : 'More detail',
      };
    case 'top_category_driver':
    case 'projected_category_surge':
      return {
        label: 'Review category detail',
        reason: categoryDelta >= 50 ? 'Worth checking' : 'More detail',
      };
    case 'projected_category_under_baseline':
      return {
        label: headroom >= 60 ? 'Try planning ahead' : 'Review category detail',
        reason: headroom >= 60 ? 'Room available' : 'More detail',
      };
    case 'recurring_cost_pressure':
      return {
        label: 'Review recurring pressure',
        reason: recurringDelta >= 50 ? 'Worth checking' : 'More detail',
      };
    default:
      return { label: 'Open detail', reason: 'More detail' };
  }
}

export function getPrimaryActionForInsight({ insightType, scope, month, categoryKey, trend }) {
  const descriptor = getInsightActionDescriptor({ type: insightType, metadata: { scope, month, category_key: categoryKey } }, { trend, insightType, categoryKey });

  switch (`${insightType || ''}`) {
    case 'projected_month_end_over_budget':
    case 'projected_month_end_under_budget':
    case 'budget_too_low':
    case 'budget_too_high':
      if (descriptor.label === 'Pressure-test a purchase' || descriptor.label === 'Try planning ahead') {
        return {
          title: descriptor.label === 'Try planning ahead' ? 'Turn this room into a plan' : 'Turn this into a plan',
          body: 'Pressure-test a purchase against this same period and scope.',
          cta: 'Open planner',
          route: {
            pathname: '/scenario-check',
            params: { scope, month },
          },
        };
      }
      return {
        title: 'Read the budget context first',
        body: 'This looks worth understanding, but it may not be large enough to warrant a purchase scenario yet.',
        cta: null,
        route: null,
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        title: 'Review the unusual spend first',
        body: 'Understanding the unusual purchases is the next best step before making a planning decision off this signal.',
        cta: null,
        route: null,
      };
    case 'spend_pace_ahead':
    case 'spend_pace_behind':
      return {
        title: 'See what is driving this pace',
        body: 'Use the breakdown below to see whether this is broad-based or concentrated in just one or two categories.',
        cta: null,
        route: null,
      };
    case 'recurring_cost_pressure':
      return {
        title: 'Review the recurring detail first',
        body: 'See which recurring costs are actually creating the squeeze before deciding whether you need to plan around it.',
        cta: null,
        route: null,
      };
    case 'top_category_driver':
    case 'projected_category_surge':
    case 'projected_category_under_baseline':
      return {
        title: 'Review the category detail first',
        body: 'The next best step is understanding the category breakdown before planning around it.',
        cta: null,
        route: null,
      };
    default:
      return null;
  }
}
