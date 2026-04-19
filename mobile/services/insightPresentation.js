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
    switch (type) {
      case 'item_staple_merchant_opportunity':
        return { label: 'Compare merchants', reason: 'Savings opportunity' };
      case 'item_merchant_variance':
        return { label: 'Compare merchants', reason: 'Actionable now' };
      case 'item_staple_emerging':
        return { label: 'Review item history', reason: 'Pattern forming' };
      case 'recurring_price_spike':
        return { label: 'Review recent prices', reason: 'Price changed' };
      case 'buy_soon_better_price':
        return { label: 'Check the lower price', reason: 'Good timing' };
      case 'recurring_repurchase_due':
        return { label: 'Review timing', reason: 'Due soon' };
      case 'recurring_restock_window':
        return { label: 'Decide whether to restock', reason: 'Room available' };
      case 'recurring_cost_pressure':
        return { label: 'Review recurring costs', reason: recurringDelta >= 20 ? 'Costs rising' : 'Needs review' };
      default:
        return { label: 'Review item detail', reason: 'Actionable now' };
    }
  }

  switch (type) {
    case 'early_budget_pace':
      return { label: 'See budget pace', reason: 'Early shift' };
    case 'early_top_category':
      return { label: 'See category driver', reason: 'Early shift' };
    case 'early_repeated_merchant':
      return { label: 'Review merchant pattern', reason: 'Pattern forming' };
    case 'early_spend_concentration':
      return { label: 'See concentrated spend', reason: 'One purchase matters' };
    case 'early_cleanup':
      return { label: 'Clean up categories', reason: 'Improve future reads' };
    case 'early_logging_momentum':
      return { label: 'See what is forming', reason: 'More to come' };
    case 'developing_weekly_spend_change':
      return { label: 'Review weekly shift', reason: 'Recent change' };
    case 'developing_category_shift':
      return { label: 'See category shift', reason: 'Recent change' };
    case 'developing_repeated_merchant':
      return { label: 'Review merchant pattern', reason: 'Recent change' };
    case 'usage_start_logging':
      return { label: 'Log first expenses', reason: metadata?.usage_context === 'quiet_period' ? 'Quiet month' : 'Getting started' };
    case 'usage_set_budget':
      return { label: 'Set budget', reason: metadata?.usage_context === 'quiet_period' ? 'Good setup moment' : 'Needs setup' };
    case 'usage_building_history':
      return { label: 'Keep logging', reason: metadata?.usage_context === 'quiet_period' ? 'Quiet month' : 'History building' };
    case 'usage_ready_to_plan':
      return { label: 'Plan a purchase', reason: metadata?.usage_context === 'quiet_period' ? 'Good time to plan' : 'Ready to use' };
    case 'spend_pace_ahead':
      return { label: 'See what is driving it', reason: historicalCount > 0 && historicalCount < 3 ? 'Low confidence' : 'Budget pressure' };
    case 'spend_pace_behind':
      return { label: 'See what is creating room', reason: 'Room opening up' };
    case 'budget_too_low':
    case 'projected_month_end_over_budget':
      return {
        label: budgetDelta >= 100 ? 'Plan around it' : 'See budget impact',
        reason: budgetDelta >= 100 ? 'Tight month' : 'Budget pressure',
      };
    case 'budget_too_high':
      return { label: 'Review budget target', reason: 'Target may be loose' };
    case 'projected_month_end_under_budget':
      return {
        label: headroom >= 100 ? 'Plan with the room' : 'See budget impact',
        reason: headroom >= 100 ? 'Room available' : 'Worth checking',
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        label: 'Review unusual purchases',
        reason: oneOffDelta >= 75 ? 'Likely one-off' : 'Needs context',
      };
    case 'top_category_driver':
    case 'projected_category_surge':
      return {
        label: 'Review category detail',
        reason: categoryDelta >= 50 ? 'Main driver' : 'Needs context',
      };
    case 'projected_category_under_baseline':
      return {
        label: headroom >= 60 ? 'Use the extra room' : 'Review category detail',
        reason: headroom >= 60 ? 'Room available' : 'More detail',
      };
    case 'recurring_cost_pressure':
      return {
        label: 'Review recurring pressure',
        reason: recurringDelta >= 50 ? 'Costs rising' : 'Needs context',
      };
    default:
      return { label: 'Open detail', reason: 'Needs context' };
  }
}

function formatCurrencyShort(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const amount = Math.abs(Number(value));
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatPercentShort(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `${Math.abs(Number(value)).toFixed(0)}%`;
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  if (!Number.isFinite(Number(count)) || Number(count) <= 0) return null;
  return `${Number(count)} ${Number(count) === 1 ? singular : plural}`;
}

export function getInsightPrimaryMetric(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};

  const metric = (value, label) => (value && label ? { value, label } : null);

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    switch (type) {
      case 'item_staple_merchant_opportunity':
      case 'item_merchant_variance':
      case 'recurring_price_spike':
      case 'buy_soon_better_price':
        return metric(formatPercentShort(metadata.delta_percent ?? metadata.discount_percent), 'price difference');
      case 'item_staple_emerging':
        return metric(formatCountLabel(metadata.occurrence_count, 'buy'), 'recent repeat rate');
      case 'recurring_repurchase_due':
        if (Number.isFinite(Number(metadata.days_until_due))) {
          const days = Number(metadata.days_until_due);
          return metric(days <= 0 ? 'Due now' : `${days}d`, 'until due');
        }
        return metric(formatCountLabel(metadata.average_gap_days, 'day'), 'usual gap');
      case 'recurring_restock_window':
        return metric(formatCurrencyShort(metadata.projected_headroom_amount), 'budget room');
      case 'recurring_cost_pressure':
        return metric(formatCurrencyShort(metadata.total_delta_amount), 'extra recurring cost');
      default:
        return null;
    }
  }

  switch (type) {
    case 'early_budget_pace':
      return metric(formatPercentShort(metadata.budget_used_percent), 'budget used');
    case 'early_top_category':
      return metric(formatPercentShort(metadata.share_of_spend), 'share so far');
    case 'early_repeated_merchant':
      return metric(formatCountLabel(metadata.merchant_count, 'visit'), 'this period');
    case 'early_spend_concentration':
      return metric(formatPercentShort(metadata.share_of_spend), 'of spend so far');
    case 'early_cleanup':
      return metric(formatCountLabel(metadata.uncategorized_count, 'expense'), 'needs category');
    case 'early_logging_momentum':
      return metric(formatCountLabel(metadata.expense_count, 'expense'), 'logged so far');
    case 'developing_weekly_spend_change':
      return metric(formatCurrencyShort(metadata.delta_amount), 'vs last window');
    case 'developing_category_shift':
      return metric(formatPercentShort(metadata.share_of_spend), 'recent share');
    case 'developing_repeated_merchant':
      return metric(formatCountLabel(metadata.merchant_count, 'visit'), 'last 7 days');
    case 'usage_start_logging':
      return null;
    case 'usage_set_budget':
      return null;
    case 'usage_building_history':
    case 'usage_ready_to_plan':
      return metric(formatCountLabel(metadata.historical_period_count, 'month'), 'history available');
    case 'spend_pace_ahead':
    case 'spend_pace_behind':
      return metric(formatPercentShort(metadata.delta_percent), 'vs usual pace');
    case 'budget_too_low':
    case 'budget_too_high':
      return metric(formatCurrencyShort(metadata.projected_over_under ?? metadata.average_actual_spend_last_6), 'projected gap');
    case 'projected_month_end_over_budget':
    case 'projected_month_end_under_budget':
      return metric(formatCurrencyShort(metadata.projected_budget_delta), 'month-end gap');
    case 'one_off_expense_skewing_projection':
      return metric(formatPercentShort((Number(metadata.unusual_spend_share || 0) * 100)), 'forecast from one-offs');
    case 'top_category_driver':
    case 'projected_category_surge':
    case 'projected_category_under_baseline':
      return metric(formatCurrencyShort(metadata.delta_amount ?? metadata.projected_headroom_amount), 'category gap');
    case 'one_offs_driving_variance':
      return metric(formatCurrencyShort(metadata.one_off_delta_amount), 'one-off impact');
    case 'recurring_cost_pressure':
      return metric(formatCurrencyShort(metadata.total_delta_amount), 'recurring pressure');
    default:
      return null;
  }
}

export function getPrimaryActionForInsight({ insightType, scope, month, categoryKey, trend }) {
  const descriptor = getInsightActionDescriptor({ type: insightType, metadata: { scope, month, category_key: categoryKey } }, { trend, insightType, categoryKey });

  switch (`${insightType || ''}`) {
    case 'early_budget_pace':
    case 'early_top_category':
    case 'early_repeated_merchant':
    case 'early_spend_concentration':
    case 'early_logging_momentum':
    case 'developing_weekly_spend_change':
    case 'developing_category_shift':
    case 'developing_repeated_merchant':
      return {
        title: 'Use this as a directional read',
        body: 'This is early, but it already points to where your spending is moving and what is worth watching next.',
        cta: null,
        route: null,
      };
    case 'early_cleanup':
      return {
        title: 'Clean up the inputs first',
        body: 'Categorizing these expenses is the fastest way to make the next insight cards more specific and more useful.',
        cta: 'Open categories',
        route: {
          pathname: '/categories',
          params: {},
        },
      };
    case 'projected_month_end_over_budget':
    case 'projected_month_end_under_budget':
    case 'budget_too_low':
    case 'budget_too_high':
      if (descriptor.label === 'Plan around it' || descriptor.label === 'Plan with the room') {
        return {
          title: descriptor.label === 'Plan with the room' ? 'Turn this room into a plan' : 'Plan around this now',
          body: 'Pressure-test a purchase against this same period and scope before this trend turns into a surprise.',
          cta: 'Open planner',
          route: {
            pathname: '/scenario-check',
            params: { scope, month },
          },
        };
      }
      return {
        title: 'Read the budget context first',
        body: 'This is worth understanding first, even if it is not big enough yet to justify a planning scenario.',
        cta: null,
        route: null,
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        title: 'Review the unusual spend first',
        body: 'Check whether this is a one-time spike before you react to the full forecast as if it were a lasting change.',
        cta: null,
        route: null,
      };
    case 'spend_pace_ahead':
    case 'spend_pace_behind':
      return {
        title: 'See what is driving this pace',
        body: 'Use the breakdown below to tell whether this is broad-based pressure or mostly coming from one or two drivers.',
        cta: null,
        route: null,
      };
    case 'recurring_cost_pressure':
      return {
        title: 'Review the recurring detail first',
        body: 'See which repeated purchases are actually creating the squeeze before you change your routine or your plan.',
        cta: null,
        route: null,
      };
    case 'recurring_price_spike':
    case 'buy_soon_better_price':
    case 'recurring_repurchase_due':
    case 'recurring_restock_window':
    case 'item_staple_merchant_opportunity':
    case 'item_merchant_variance':
    case 'item_staple_emerging':
      return {
        title: 'Review the item detail first',
        body: 'Use the item history, merchant comparison, and recent purchases to decide whether this is worth acting on right now.',
        cta: null,
        route: null,
      };
    case 'top_category_driver':
    case 'projected_category_surge':
    case 'projected_category_under_baseline':
      return {
        title: 'Review the category detail first',
        body: 'See whether this category reflects a sustained shift, one large purchase, or a short-lived spike before you plan around it.',
        cta: null,
        route: null,
      };
    default:
      return null;
  }
}
