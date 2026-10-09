export function getInsightActionDescriptor(insight, context = {}) {
  if (insight?.action?.cta || insight?.action?.title) {
    const nextStepType = `${insight?.action?.reason || insight?.action?.next_step_type || ''}`
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return {
      label: insight.action.cta || insight.action.title,
      reason: nextStepType || 'Actionable now',
    };
  }
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

  if (type === 'recurring_repurchase_due' && Number(metadata.bundle_item_count || 0) > 1) {
    return { label: 'Review usual basket', reason: 'Shared timing signal' };
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    switch (type) {
      case 'item_staple_merchant_opportunity':
        return { label: 'Compare merchants', reason: 'Savings opportunity' };
      case 'item_merchant_variance':
        return { label: 'Compare merchants', reason: 'Actionable now' };
      case 'item_staple_emerging':
        return { label: 'Review item history', reason: 'Pattern forming' };
      case 'item_recent_price_jump':
        return { label: 'Review recent item price', reason: 'Price moved' };
      case 'item_repurchase_accelerating':
        return { label: 'Review item rhythm', reason: 'Buying faster' };
      case 'item_pattern_lapsed':
        return { label: 'Review item history', reason: 'Pattern changed' };
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
      return { label: 'Plan a purchase', reason: metadata?.planning_confidence === 'directional' ? 'Directional read' : (metadata?.usage_context === 'quiet_period' ? 'Good time to plan' : 'Ready to use') };
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
      return { label: 'Review evidence', reason: 'Needs context' };
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

function formatTypicalCost(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const amount = Math.abs(Number(value));
  return amount >= 1000 ? formatCurrencyShort(amount) : `$${amount.toFixed(2)}`;
}

function formatPercentShort(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `${Math.abs(Number(value)).toFixed(0)}%`;
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  if (!Number.isFinite(Number(count)) || Number(count) <= 0) return null;
  return `${Number(count)} ${Number(count) === 1 ? singular : plural}`;
}

function firstSentence(value) {
  const text = `${value || ''}`.trim();
  if (!text) return '';
  const sentenceEnd = text.search(/[.!?]\s/);
  return sentenceEnd === -1 ? text : text.slice(0, sentenceEnd + 1);
}

function itemNameForCard(insight, metadata) {
  return metadata.item_name || metadata.product_name || insight?.title?.split(/\s+(?:is|has|came|looks|tends|may|could)\s/i)?.[0] || 'This item';
}

function merchantNameForCard(metadata) {
  return metadata.merchant_name
    || metadata.latest_merchant
    || metadata.merchant
    || metadata.largest_expense?.merchant
    || metadata.top_unusual_expense?.merchant
    || null;
}

function compactDelta(value, positiveLabel, negativeLabel) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return '';
  const direction = Number(value) > 0 ? positiveLabel : negativeLabel;
  return `${formatCurrencyShort(value)} ${direction}.`;
}

export function getInsightCardCopy(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};
  const itemName = itemNameForCard(insight, metadata);
  const categoryName = metadata.category_name || 'This category';
  const merchantName = merchantNameForCard(metadata);
  const count = Number(metadata.occurrence_count || metadata.merchant_count || 0);
  const daysUntilDue = Number(metadata.days_until_due);

  switch (type) {
    case 'early_budget_pace':
      return {
        title: 'Budget is moving quickly',
        body: metadata.days_remaining == null ? 'Spending is ahead of the usual pace.' : `${metadata.days_remaining} days remain.`,
      };
    case 'early_top_category':
    case 'top_category_driver':
      return {
        title: `${categoryName} is driving spend`,
        body: '',
      };
    case 'developing_category_shift':
      return {
        title: `${categoryName} is picking up`,
        body: metadata.share_of_spend ? `${Math.round(Number(metadata.share_of_spend))}% of recent spending.` : compactDelta(metadata.delta_amount, 'above last week', 'below last week'),
      };
    case 'projected_category_surge':
      return {
        title: `${categoryName} may finish high`,
        body: '',
      };
    case 'projected_category_under_baseline':
      return {
        title: `${categoryName} has room`,
        body: '',
      };
    case 'early_repeated_merchant':
    case 'developing_repeated_merchant':
      return {
        title: `${merchantName || 'A merchant'} is repeating`,
        body: count ? `${count} visits in the current window.` : '',
      };
    case 'developing_weekly_spend_change': {
      const delta = Number(metadata.delta_amount || 0);
      return {
        title: delta < 0 ? 'Spending eased this week' : 'Spending rose this week',
        body: '',
      };
    }
    case 'early_spend_concentration':
      return {
        title: 'One purchase dominates the month',
        body: merchantName && metadata.share_of_spend ? `${merchantName} is ${Math.round(Number(metadata.share_of_spend))}% of spending.` : '',
      };
    case 'early_cleanup':
      return {
        title: `${formatCountLabel(metadata.uncategorized_count, 'expense') || 'Some expenses'} need categories`,
        body: 'Categorizing them will sharpen future insights.',
      };
    case 'early_logging_momentum':
      return {
        title: 'Your spending picture is taking shape',
        body: formatCountLabel(metadata.expense_count, 'expense') || '',
      };
    case 'usage_start_logging':
      return {
        title: metadata.scope === 'household' ? 'Start with shared expenses' : 'Start with a few expenses',
        body: 'A little history unlocks useful patterns.',
      };
    case 'usage_set_budget':
      return {
        title: 'Set a budget baseline',
        body: 'A target makes spending changes easier to judge.',
      };
    case 'usage_building_history':
      return {
        title: 'Your baseline is still forming',
        body: metadata.historical_period_count
          ? `${metadata.historical_period_count} completed ${Number(metadata.historical_period_count) === 1 ? 'period' : 'periods'} so far.`
          : 'Keep logging to sharpen future insights.',
      };
    case 'usage_ready_to_plan':
      return {
        title: 'You have enough history to plan',
        body: metadata.planning_confidence === 'directional'
          ? 'Start with a smaller what-if.'
          : 'Pressure-test a purchase against this month.',
      };
    case 'spend_pace_ahead':
      return {
        title: 'Spending is ahead of pace',
        body: '',
      };
    case 'spend_pace_behind':
      return {
        title: 'Spending is below pace',
        body: '',
      };
    case 'budget_too_low':
    case 'projected_month_end_over_budget':
      return {
        title: 'The month may finish over budget',
        body: metadata.top_driver?.category_name ? `${metadata.top_driver.category_name} is the biggest driver.` : '',
      };
    case 'budget_too_high':
    case 'projected_month_end_under_budget':
      return {
        title: 'The month may finish under budget',
        body: 'There may be room to redirect or save.',
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        title: 'One purchase is skewing the month',
        body: merchantName ? `${merchantName} is driving the difference.` : 'The underlying pace is steadier.',
      };
    case 'item_recent_price_jump':
    case 'recurring_price_spike':
      return {
        title: `${itemName} cost more`,
        body: '',
      };
    case 'recurring_better_than_usual':
      return {
        title: `${itemName} cost less than usual`,
        body: '',
      };
    case 'recurring_cheaper_elsewhere':
    case 'item_merchant_variance':
    case 'item_staple_merchant_opportunity':
      return {
        title: `${itemName} costs less at ${metadata.cheaper_merchant || 'another store'}`,
        body: '',
      };
    case 'buy_soon_better_price':
      return {
        title: `${itemName} is cheaper now`,
        body: '',
      };
    case 'item_repurchase_accelerating':
      return {
        title: `${itemName} is repeating sooner`,
        body: '',
      };
    case 'item_pattern_lapsed':
      return {
        title: `${itemName} may have dropped off`,
        body: '',
      };
    case 'item_staple_emerging':
      return {
        title: `${itemName} is becoming routine`,
        body: '',
      };
    case 'recurring_repurchase_due':
      return {
        title: daysUntilDue <= 0 ? `${itemName} may be due now` : `${itemName} may be due soon`,
        body: '',
      };
    case 'recurring_restock_window':
      return {
        title: `${itemName} could fit this month`,
        body: '',
      };
    case 'recurring_cost_pressure':
      return {
        title: insight?.entity_type === 'item' ? `${itemName} is costing more` : 'Recurring costs are rising',
        body: Array.isArray(metadata.items) && metadata.items.length
          ? `${metadata.items.slice(0, 2).join(' and ')} are above usual.`
          : (formatCountLabel(metadata.recurring_line_count, 'item') || ''),
      };
    default:
      return {
        title: insight?.title || 'Insight',
        body: firstSentence(insight?.body),
      };
  }
}

function addRow(rows, label, value) {
  if (!value) return;
  if (rows.some((row) => row.label === label && row.value === value)) return;
  rows.push({ label, value });
}

function stageLabelForInsightType(type, maturity = '') {
  const cleanMaturity = `${maturity || ''}`.trim();
  if (cleanMaturity === 'early' || type.startsWith('early_')) {
    return { label: 'Early pattern', detail: 'Still taking shape' };
  }
  if (cleanMaturity === 'developing' || type.startsWith('developing_')) {
    return { label: 'Pattern forming', detail: 'Still possible to steer' };
  }
  if (cleanMaturity === 'mature') {
    return { label: 'Steadier history', detail: 'Built on repeated activity' };
  }
  return { label: 'Worth a look', detail: 'Current activity changed' };
}

function strengthLabelForInsight(confidence = '') {
  const cleanConfidence = `${confidence || ''}`.trim();
  switch (cleanConfidence) {
    case 'observed':
      return { label: 'Observed pattern', detail: 'Tied to repeated activity' };
    case 'comparative':
      return { label: 'Strong comparison', detail: 'Compared with your usual pattern' };
    case 'descriptive':
      return { label: 'Directional', detail: 'Still taking shape' };
    case 'directional':
      return { label: 'Directional', detail: 'Good for a first pass' };
    case 'low':
      return { label: 'Soft pattern', detail: 'Treat this as a prompt to look closer' };
    default:
      return { label: '', detail: '' };
  }
}

function categoryQualityLabel(metadata = {}) {
  if (metadata.category_trust_score == null) return null;
  const score = Number(metadata.category_trust_score || 0);
  if (score >= 0.9) return 'Strong category quality';
  if (score >= 0.75) return 'Solid category quality';
  if (score >= 0.55) return 'Mixed category quality';
  return 'Weak category quality';
}

function historyLabel(metadata = {}, type = '') {
  if (Number.isFinite(Number(metadata.historical_period_count)) && Number(metadata.historical_period_count) > 0) {
    return formatCountLabel(metadata.historical_period_count, 'month');
  }
  if (type.startsWith('item_') || type.startsWith('recurring_') || type === 'buy_soon_better_price') {
    return formatCountLabel(metadata.occurrence_count, 'purchase');
  }
  if (Number.isFinite(Number(metadata.expense_count)) && Number(metadata.expense_count) > 0) {
    return formatCountLabel(metadata.expense_count, 'expense');
  }
  if (Number.isFinite(Number(metadata.merchant_count)) && Number(metadata.merchant_count) > 0) {
    return formatCountLabel(metadata.merchant_count, 'visit');
  }
  return null;
}

function genericSupportRows(metadata = {}) {
  const rows = [];
  addRow(rows, 'Spend so far', formatCurrencyShort(metadata.current_spend_to_date ?? metadata.current_spend));
  addRow(rows, 'Usual spend', formatCurrencyShort(metadata.previous_spend));
  addRow(rows, 'Projected gap', formatCurrencyShort(metadata.projected_budget_delta ?? metadata.projected_over_under));
  addRow(rows, 'History compared', historyLabel(metadata));
  addRow(rows, 'Expenses', formatCountLabel(metadata.expense_count, 'expense'));
  addRow(rows, 'Active days', formatCountLabel(metadata.active_day_count, 'day'));
  return rows;
}

export function getInsightPrimaryMetric(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};

  const metric = (value, label) => (value && label ? { value, label } : null);

  if (type === 'recurring_repurchase_due' && Number(metadata.bundle_item_count || 0) > 1) {
    if (Number.isFinite(Number(metadata.days_until_due))) {
      const days = Number(metadata.days_until_due);
      return metric(days <= 0 ? 'Due now' : `${days}d`, 'shared timing');
    }
    return metric(formatCountLabel(metadata.bundle_item_count, 'item'), 'usual basket');
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    switch (type) {
      case 'item_staple_merchant_opportunity':
      case 'item_merchant_variance':
        if (Number(metadata.delta_amount || 0) >= 1) {
          return metric(formatTypicalCost(metadata.delta_amount), 'less per buy');
        }
        return metric(formatPercentShort(metadata.delta_percent), 'price difference');
      case 'recurring_price_spike':
      case 'item_recent_price_jump':
        return metric(formatPercentShort(metadata.delta_percent ?? metadata.discount_percent), 'price difference');
      case 'buy_soon_better_price':
        if (Number(metadata.savings_amount || 0) >= 1) {
          return metric(formatTypicalCost(metadata.savings_amount), 'potential savings');
        }
        return metric(formatPercentShort(metadata.discount_percent), 'price difference');
      case 'item_repurchase_accelerating':
        if (Number.isFinite(Number(metadata.latest_gap_days))) {
          return metric(`${Number(metadata.latest_gap_days)}d`, 'latest gap');
        }
        return metric(formatCountLabel(metadata.occurrence_count, 'buy'), 'recent repeat rate');
      case 'item_pattern_lapsed':
        return metric(formatCountLabel(metadata.days_since_last_purchase, 'day'), 'since last purchase');
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
      if (metadata.projected_headroom_amount != null && Number(metadata.projected_headroom_amount) > 0) {
        return metric(formatCurrencyShort(metadata.projected_headroom_amount), 'room to test');
      }
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

export function getInsightScopeLabel(insight, context = {}) {
  const metadata = insight?.metadata || context.metadata || {};
  const scopes = Array.isArray(metadata.consolidated_scopes) ? metadata.consolidated_scopes : [];
  if (scopes.includes('personal') && scopes.includes('household')) return 'You + household';
  if (metadata.scope === 'household') return 'Household';
  if (metadata.scope === 'personal') return 'You';
  return insight?.entity_type === 'item' ? 'Household' : 'You';
}

export function getInsightTimeframeLabel(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};
  if (type.includes('weekly') || type.startsWith('developing_')) return 'Last 7 days';
  if (type.startsWith('early_')) return 'This period';
  if (type.startsWith('item_') || type.startsWith('recurring_') || type === 'buy_soon_better_price') {
    return 'Recent purchases';
  }
  const month = `${metadata.month || ''}`;
  if (/^\d{4}-\d{2}$/.test(month)) {
    const date = new Date(`${month}-01T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  return 'Current period';
}

export function getInsightConfidenceLabel(insight, context = {}) {
  const metadata = insight?.metadata || context.metadata || {};
  const confidence = `${metadata.confidence || ''}`.trim();
  const history = Number(metadata.historical_period_count || metadata.occurrence_count || 0);
  if (confidence === 'observed' || confidence === 'comparative' || history >= 4) return 'Strong signal';
  if (confidence === 'low' || metadata.maturity === 'early' || `${insight?.type || ''}`.startsWith('early_')) return 'Early signal';
  return 'Directional';
}

export function getInsightStageDescriptor(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};
  return stageLabelForInsightType(type, metadata.maturity);
}

export function getInsightSupportRows(insight, context = {}) {
  const type = `${insight?.type || context.insightType || ''}`;
  const metadata = insight?.metadata || context.metadata || {};
  const rows = [];

  if (type === 'recurring_repurchase_due' && Number(metadata.bundle_item_count || 0) > 1) {
    addRow(rows, 'Usual store', metadata.usual_merchant);
    addRow(rows, 'Usual basket', formatTypicalCost(metadata.typical_cost ?? metadata.median_amount));
    addRow(rows, 'Items', Array.isArray(metadata.bundle_item_names) ? metadata.bundle_item_names.join(', ') : null);
    addRow(rows, 'Bought together', formatCountLabel(metadata.bundle_co_purchase_count, 'time'));
    if (Number.isFinite(Number(metadata.average_gap_days))) {
      addRow(rows, 'Usual gap', `${Number(metadata.average_gap_days)} days`);
    }
    return rows.slice(0, Math.max(1, Number(context.limit || 2)));
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    switch (type) {
      case 'item_staple_merchant_opportunity':
      case 'item_merchant_variance':
        addRow(rows, 'Best merchant', metadata.cheaper_merchant);
        addRow(rows, 'Estimated savings', formatTypicalCost(metadata.delta_amount));
        addRow(rows, `Typical at ${metadata.cheaper_merchant || 'best merchant'}`, formatTypicalCost(metadata.cheaper_value));
        addRow(rows, 'Price difference', formatPercentShort(metadata.delta_percent));
        addRow(rows, 'Compared', formatCountLabel(metadata.merchant_evidence_count ?? metadata.occurrence_count, 'purchase'));
        break;
      case 'item_recent_price_jump':
      case 'recurring_price_spike':
        addRow(rows, 'Latest merchant', metadata.latest_merchant);
        addRow(rows, 'Price jump', formatPercentShort(metadata.delta_percent));
        addRow(rows, 'Latest price', formatTypicalCost(metadata.latest_amount));
        addRow(rows, 'Usual price', formatTypicalCost(metadata.baseline_amount ?? metadata.prior_median_amount ?? metadata.median_amount));
        break;
      case 'item_repurchase_accelerating':
        if (Number.isFinite(Number(metadata.latest_gap_days))) {
          addRow(rows, 'Latest gap', `${Number(metadata.latest_gap_days)} days`);
        }
        if (Number.isFinite(Number(metadata.average_gap_days))) {
          addRow(rows, 'Usual gap', `${Number(metadata.average_gap_days)} days`);
        }
        addRow(rows, 'Recent purchases', formatCountLabel(metadata.occurrence_count, 'purchase'));
        break;
      case 'item_staple_emerging':
        addRow(rows, 'Recent purchases', formatCountLabel(metadata.occurrence_count, 'purchase'));
        if (Number.isFinite(Number(metadata.average_gap_days))) {
          addRow(rows, 'Usual gap', `${Number(metadata.average_gap_days)} days`);
        }
        addRow(rows, 'Typical spend', formatCurrencyShort(metadata.median_amount));
        break;
      case 'item_pattern_lapsed':
        addRow(rows, 'Since last purchase', formatCountLabel(metadata.days_since_last_purchase, 'day'));
        addRow(rows, 'Usual gap', formatCountLabel(metadata.average_gap_days, 'day'));
        addRow(rows, 'History used', formatCountLabel(metadata.evidence_count ?? metadata.occurrence_count, 'purchase'));
        break;
      case 'buy_soon_better_price':
        addRow(rows, 'Lower-price merchant', metadata.merchant);
        addRow(rows, 'Observed price', formatTypicalCost(metadata.observed_price ?? metadata.observed_unit_price));
        addRow(rows, 'Usual price', formatTypicalCost(metadata.baseline_price ?? metadata.baseline_unit_price));
        addRow(rows, 'Potential savings', formatTypicalCost(metadata.savings_amount));
        addRow(rows, 'Price difference', formatPercentShort(metadata.discount_percent));
        if (Number.isFinite(Number(metadata.days_until_due))) {
          const days = Number(metadata.days_until_due);
          addRow(rows, 'Need timing', days <= 0 ? 'Due now' : `${days} days`);
        }
        break;
      case 'recurring_repurchase_due':
        addRow(rows, 'Usual store', metadata.usual_merchant || metadata.merchants?.[0]);
        addRow(rows, 'Usual cost', formatTypicalCost(metadata.typical_cost ?? metadata.median_amount));
        if (Number.isFinite(Number(metadata.days_until_due))) {
          const days = Number(metadata.days_until_due);
          addRow(rows, 'Need timing', days <= 0 ? 'Due now' : `${days} days`);
        }
        if (Number.isFinite(Number(metadata.average_gap_days))) {
          addRow(rows, 'Usual gap', `${Number(metadata.average_gap_days)} days`);
        }
        break;
      case 'recurring_restock_window':
        addRow(rows, 'Budget room', formatCurrencyShort(metadata.projected_headroom_amount));
        if (Number.isFinite(Number(metadata.days_until_due))) {
          addRow(rows, 'Need timing', `${Math.max(Number(metadata.days_until_due), 0)} days`);
        }
        break;
      case 'recurring_cost_pressure':
        addRow(rows, 'Extra cost', formatCurrencyShort(metadata.total_delta_amount));
        addRow(rows, 'Items involved', formatCountLabel(metadata.recurring_line_count, 'line'));
        addRow(rows, 'History used', formatCountLabel(metadata.occurrence_count, 'purchase'));
        break;
      default:
        break;
    }
  } else {
    switch (type) {
      case 'early_budget_pace':
        addRow(rows, 'Budget used', formatPercentShort(metadata.budget_used_percent));
        addRow(rows, 'Spend so far', formatCurrencyShort(metadata.current_spend_to_date));
        addRow(rows, 'Expenses logged', formatCountLabel(metadata.expense_count, 'expense'));
        break;
      case 'early_top_category':
      case 'developing_category_shift':
      case 'top_category_driver':
      case 'projected_category_surge':
      case 'projected_category_under_baseline':
        addRow(rows, 'Category', metadata.category_name);
        addRow(rows, 'Spend so far', formatCurrencyShort(
          metadata.current_spend_to_date
          ?? metadata.current_spend
          ?? metadata.category_spend
          ?? metadata.adjusted_projected_total
        ));
        addRow(rows, 'Usual spend', formatCurrencyShort(
          metadata.previous_spend
          ?? metadata.historical_spend_to_date_avg
          ?? metadata.historical_average_total
          ?? metadata.baseline_projected_total
        ));
        addRow(rows, 'Expenses', formatCountLabel(metadata.expense_count ?? metadata.category_count, 'expense'));
        break;
      case 'early_repeated_merchant':
      case 'developing_repeated_merchant':
        addRow(rows, 'Merchant', metadata.merchant_name);
        addRow(rows, 'Visits', formatCountLabel(metadata.merchant_count, 'visit'));
        addRow(rows, 'Spend so far', formatCurrencyShort(metadata.current_spend ?? metadata.merchant_spend));
        break;
      case 'early_spend_concentration':
        addRow(rows, 'Share of spend', formatPercentShort(metadata.share_of_spend));
        addRow(rows, 'Largest purchase', formatCurrencyShort(metadata.largest_expense?.amount));
        addRow(rows, 'Expenses', formatCountLabel(metadata.expense_count, 'expense'));
        break;
      case 'early_cleanup':
        addRow(rows, 'Needs category', formatCountLabel(metadata.uncategorized_count, 'expense'));
        addRow(rows, 'Expenses logged', formatCountLabel(metadata.expense_count, 'expense'));
        break;
      case 'early_logging_momentum':
        addRow(rows, 'Expenses logged', formatCountLabel(metadata.expense_count, 'expense'));
        addRow(rows, 'Active days', formatCountLabel(metadata.active_day_count, 'day'));
        break;
      case 'developing_weekly_spend_change':
        addRow(rows, 'Recent shift', formatCurrencyShort(metadata.delta_amount));
        addRow(rows, 'Last 7 days', formatCurrencyShort(metadata.current_spend));
        addRow(rows, 'Prior 7 days', formatCurrencyShort(metadata.previous_spend));
        addRow(rows, 'Expenses', formatCountLabel(metadata.expense_count, 'expense'));
        addRow(rows, 'Active days', formatCountLabel(metadata.active_day_count, 'day'));
        break;
      case 'usage_start_logging':
        addRow(rows, 'Expenses logged', formatCountLabel(metadata.expense_count, 'expense'));
        addRow(rows, 'History available', formatCountLabel(metadata.historical_period_count, 'month'));
        break;
      case 'usage_set_budget':
        addRow(rows, 'Spend so far', formatCurrencyShort(metadata.current_spend_to_date));
        addRow(rows, 'Expenses logged', formatCountLabel(metadata.expense_count, 'expense'));
        break;
      case 'usage_building_history':
      case 'usage_ready_to_plan':
        addRow(rows, 'History available', formatCountLabel(metadata.historical_period_count, 'month'));
        addRow(rows, 'Budget room', formatCurrencyShort(metadata.projected_headroom_amount));
        break;
      case 'spend_pace_ahead':
      case 'spend_pace_behind':
        addRow(rows, 'Pace difference', formatPercentShort(metadata.delta_percent));
        addRow(rows, 'Spend so far', formatCurrencyShort(metadata.current_spend_to_date));
        addRow(rows, 'Usual pace', formatCurrencyShort(metadata.historical_spend_to_date_avg));
        addRow(rows, 'History compared', formatCountLabel(metadata.historical_period_count, 'month'));
        break;
      case 'budget_too_low':
      case 'budget_too_high':
      case 'projected_month_end_over_budget':
      case 'projected_month_end_under_budget':
        if (metadata.top_driver?.category_name && Number(metadata.top_driver?.delta_amount || 0) > 0) {
          addRow(rows, 'Biggest driver', `${metadata.top_driver.category_name} +${formatCurrencyShort(metadata.top_driver.delta_amount)}`);
        }
        addRow(rows, 'Month-end gap', formatCurrencyShort(metadata.projected_budget_delta ?? metadata.projected_over_under));
        addRow(rows, 'Projected total', formatCurrencyShort(metadata.adjusted_projected_total));
        addRow(rows, 'Usual total', formatCurrencyShort(metadata.baseline_projected_total ?? metadata.average_actual_spend_last_6));
        addRow(rows, 'History compared', formatCountLabel(metadata.historical_period_count, 'month'));
        break;
      case 'one_off_expense_skewing_projection':
      case 'one_offs_driving_variance':
        addRow(rows, 'One-off impact', formatCurrencyShort(metadata.one_off_delta_amount));
        addRow(rows, 'Largest purchase', formatCurrencyShort(metadata.largest_expense?.amount));
        addRow(rows, 'Merchant', metadata.largest_expense?.merchant);
        break;
      case 'recurring_cost_pressure':
        addRow(rows, 'Recurring pressure', formatCurrencyShort(metadata.total_delta_amount));
        addRow(rows, 'Items involved', formatCountLabel(metadata.recurring_line_count, 'line'));
        addRow(rows, 'History compared', formatCountLabel(metadata.historical_period_count, 'month'));
        break;
      default:
        break;
    }
  }

  const fallbackRows = genericSupportRows(metadata);
  for (const row of fallbackRows) addRow(rows, row.label, row.value);

  return rows.slice(0, Math.max(1, Number(context.limit || 2)));
}

export function getInsightTechnicalSummary(insight, context = {}) {
  const metadata = insight?.metadata || context.metadata || {};
  const type = `${insight?.type || context.insightType || ''}`;
  const stage = stageLabelForInsightType(type, metadata.maturity);
  const strength = strengthLabelForInsight(metadata.confidence);
  const scope = getInsightScopeLabel(insight, context);
  const history = historyLabel(metadata, type);
  const categoryQuality = categoryQualityLabel(metadata);
  const parts = [stage.label];
  if (strength.label) parts.push(strength.label);
  if (scope) parts.push(scope);
  if (history) parts.push(`Using ${history}`);
  if (categoryQuality) parts.push(categoryQuality);
  return parts.filter(Boolean).slice(0, 4).join(' / ');
}

export function getInsightTechnicalRows(insight, context = {}) {
  const metadata = insight?.metadata || context.metadata || {};
  const type = `${insight?.type || context.insightType || ''}`;
  const stage = stageLabelForInsightType(type, metadata.maturity);
  const strength = strengthLabelForInsight(metadata.confidence);
  const categoryQuality = categoryQualityLabel(metadata);
  const rows = [];

  addRow(rows, 'Read stage', stage.label);
  addRow(rows, 'Signal strength', strength.label);
  addRow(rows, 'Scope', getInsightScopeLabel(insight, context));
  addRow(rows, 'History used', historyLabel(metadata, type));
  addRow(rows, 'Category quality', categoryQuality);

  if (metadata.scope_relationship === 'personal_household_overlap') {
    addRow(rows, 'Combined view', 'Personal activity with household overlap');
  } else if (Array.isArray(metadata.consolidated_scopes) && metadata.consolidated_scopes.length > 1) {
    addRow(rows, 'Combined view', metadata.consolidated_scopes.map((scope) => `${scope}`.replace(/\b\w/g, (char) => char.toUpperCase())).join(' + '));
  }

  return rows;
}

export function getPrimaryActionForInsight({ insightType, scope, month, categoryKey, trend, metadata = {} }) {
  const descriptor = getInsightActionDescriptor({ type: insightType, metadata: { scope, month, category_key: categoryKey, ...metadata } }, { trend, insightType, categoryKey, metadata });

  switch (`${insightType || ''}`) {
    case 'usage_start_logging':
    case 'usage_building_history':
      return {
        title: insightType === 'usage_start_logging' ? 'Add the first signal' : 'Keep building the pattern',
        body: 'Add another expense so future insights can compare a stronger history.',
        cta: 'Add expense',
        route: '/(tabs)/add',
      };
    case 'usage_set_budget':
      return {
        title: 'Add a budget target',
        body: 'A budget gives spending changes a useful reference point.',
        cta: 'Set budget',
        route: '/budget-period',
      };
    case 'early_budget_pace':
      return {
        title: 'Check the budget behind this pace',
        body: 'Review the current target before deciding whether spending or the budget itself needs to change.',
        cta: 'Review budget',
        route: '/budget-period',
      };
    case 'early_top_category':
    case 'early_repeated_merchant':
    case 'early_spend_concentration':
    case 'developing_weekly_spend_change':
    case 'developing_category_shift':
    case 'developing_repeated_merchant':
      return {
        title: 'Check the purchases behind this read',
        body: 'Review the supporting expenses and correct any amount, merchant, date, or category that does not belong.',
        cta: 'Review supporting expenses',
        route: null,
        local_action: 'show_evidence',
      };
    case 'early_logging_momentum':
      return {
        title: 'Keep strengthening the signal',
        body: 'Another expense or two will make the next comparison more specific.',
        cta: 'Add expense',
        route: '/(tabs)/add',
      };
    case 'early_cleanup':
      return {
        title: 'Clean up the inputs first',
        body: 'Categorizing these expenses will make future cards more specific.',
        cta: 'Open categories',
        route: {
          pathname: '/categories',
          params: {},
        },
      };
    case 'usage_ready_to_plan':
      return {
        title: 'Start pressure-testing a purchase',
        body: metadata?.planning_confidence === 'directional'
          ? 'Use the planner for a smaller directional what-if first, then compare timing before treating the room as fully reliable.'
          : 'Use the planner to compare whether a purchase fits better now, next period, or spread out.',
        cta: 'Open planner',
        route: {
          pathname: '/scenario-check',
          params: { scope, month },
        },
      };
    case 'projected_month_end_over_budget':
    case 'projected_month_end_under_budget':
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
        title: 'Pressure-test the month before it closes',
        body: 'Use the planner to see how another purchase would change this projection.',
        cta: 'Open planner',
        route: { pathname: '/scenario-check', params: { scope, month } },
      };
    case 'budget_too_low':
    case 'budget_too_high':
      return {
        title: 'Review the target itself',
        body: 'Compare the budget with your recent actual spending and adjust it if the target no longer fits.',
        cta: 'Review budget',
        route: '/budget-period',
      };
    case 'one_off_expense_skewing_projection':
    case 'one_offs_driving_variance':
      return {
        title: 'Review the unusual spend first',
        body: 'Check whether this is a one-time spike before you react to the full forecast as if it were a lasting change.',
        cta: 'Review supporting expenses',
        route: null,
        local_action: 'show_evidence',
      };
    case 'spend_pace_ahead':
    case 'spend_pace_behind':
      return {
        title: 'See what is driving this pace',
        body: 'Review the current budget target alongside the pace before deciding what to change.',
        cta: 'Review budget',
        route: '/budget-period',
      };
    case 'recurring_cost_pressure':
      return {
        title: 'Review the recurring detail first',
        body: 'See which repeated purchases are actually creating the squeeze before you change your routine or your plan.',
        cta: null,
        route: null,
      };
    case 'recurring_price_spike':
    case 'recurring_better_than_usual':
    case 'recurring_cheaper_elsewhere':
    case 'item_recent_price_jump':
    case 'item_repurchase_accelerating':
    case 'item_pattern_lapsed':
    case 'buy_soon_better_price':
    case 'recurring_repurchase_due':
    case 'recurring_restock_window':
    case 'item_staple_merchant_opportunity':
    case 'item_merchant_variance':
    case 'item_staple_emerging':
      if (insightType === 'recurring_repurchase_due' && Number(metadata.bundle_item_count || 0) > 1) {
        const firstItem = Array.isArray(metadata.bundle_items) ? metadata.bundle_items[0] : null;
        return {
          title: 'Review the usual basket',
          body: 'Check the items, shared purchase history, usual store, and combined cost before adding them to your list.',
          cta: firstItem?.group_key ? 'Review item histories' : 'Review grouped evidence',
          route: firstItem?.group_key ? {
            pathname: '/recurring-item',
            params: {
              group_key: firstItem.group_key,
              scope,
              title: firstItem.item_name || 'Recurring item',
              insight_type: insightType,
            },
          } : null,
          local_action: firstItem?.group_key ? null : 'show_evidence',
        };
      }
      return {
        title: 'Review the item detail first',
        body: 'Use the item history, merchant comparison, and recent purchases to decide whether this is worth acting on right now.',
        cta: metadata.group_key ? 'Open item detail' : null,
        route: metadata.group_key ? {
          pathname: '/recurring-item',
          params: {
            group_key: metadata.group_key,
            scope,
            title: metadata.item_name || 'Recurring item',
            insight_type: insightType,
          },
        } : null,
      };
    case 'top_category_driver':
    case 'projected_category_surge':
    case 'projected_category_under_baseline':
      return {
        title: 'Review the category detail first',
        body: 'See whether this category reflects a sustained shift, one large purchase, or a short-lived spike before you plan around it.',
        cta: 'Review supporting expenses',
        route: null,
        local_action: 'show_evidence',
      };
    default:
      return null;
  }
}

export function getInsightCardAction(insight, context = {}) {
  const metadata = insight?.metadata || context.metadata || {};
  const descriptor = getInsightActionDescriptor(insight, context);
  const primaryAction = getPrimaryActionForInsight({
    insightType: insight?.type || context.insightType,
    scope: metadata.scope || context.scope || 'personal',
    month: metadata.month || context.month || '',
    categoryKey: metadata.category_key || context.categoryKey || '',
    metadata,
    trend: context.trend || null,
  });
  const directRoute = insight?.action?.route || primaryAction?.route || null;

  return {
    label: primaryAction?.cta || descriptor.label,
    reason: primaryAction?.title || descriptor.reason,
    route: directRoute,
    kind: directRoute ? 'action' : 'evidence',
  };
}
