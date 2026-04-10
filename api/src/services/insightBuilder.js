const { detectRecurringItemSignals, detectRecurringWatchCandidates } = require('./recurringDetector');
const { analyzeSpendingTrend } = require('./spendingTrendAnalyzer');
const { analyzeSpendProjection } = require('./spendProjectionAnalyzer');
const { findObservationOpportunities } = require('./priceObservationService');
const db = require('../db');
const BudgetSetting = require('../models/budgetSetting');
const { inferOutcomeEventsForUser } = require('./insightOutcomeInference');
const InsightState = require('../models/insightState');
const InsightEvent = require('../models/insightEvent');
const Household = require('../models/household');
const { summarizeFeedbackEvents, feedbackAdjustmentForInsight, shouldSuppressInsight } = require('./insightFeedbackSummary');

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateOnly(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function severityForSignal(signal, deltaPercent) {
  const pct = Math.abs(Number(deltaPercent || 0));
  if (signal === 'price_spike' && pct >= 20) return 'high';
  if (signal === 'cheaper_elsewhere' && pct >= 20) return 'high';
  if (pct >= 12) return 'medium';
  return 'low';
}

function titleForSignal(signal, itemName) {
  switch (signal) {
    case 'price_spike':
      return `${itemName} cost more than usual`;
    case 'better_than_usual':
      return `${itemName} was cheaper than usual`;
    case 'cheaper_elsewhere':
      return `${itemName} is usually cheaper elsewhere`;
    default:
      return itemName;
  }
}

function bodyForSignal(signal, insight) {
  const pct = Math.abs(Number(insight.delta_percent || 0));
  switch (signal) {
    case 'price_spike':
      return `This purchase at ${insight.latest_merchant} was ${pct}% above your usual ${insight.comparison_type === 'unit_price' ? 'unit price' : 'price'}.`;
    case 'better_than_usual':
      return `This purchase at ${insight.latest_merchant} came in ${pct}% below your usual ${insight.comparison_type === 'unit_price' ? 'unit price' : 'price'}.`;
    case 'cheaper_elsewhere':
      return `${insight.cheaper_merchant} has recently been ${pct}% cheaper than ${insight.latest_merchant} for this item.`;
    default:
      return '';
  }
}

function toInsight(signal) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: `${signal.signal}:${signal.group_key}:${signal.latest_date}`,
    type: `recurring_${signal.signal}`,
    title: titleForSignal(signal.signal, signal.item_name),
    body: bodyForSignal(signal.signal, signal),
    severity: severityForSignal(signal.signal, signal.delta_percent),
    entity_type: 'item',
    entity_id: signal.group_key,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: signal,
    actions: [],
  };
}

function toRepurchaseDueInsight(candidate) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const itemName = candidate.item_name || 'A recurring purchase';
  let title = `${itemName} may be due soon`;
  let body = `You usually buy this about every ${candidate.average_gap_days} days, and it looks like you may need it again in ${candidate.days_until_due} days.`;

  if (candidate.status === 'due_today') {
    title = `${itemName} may be due today`;
    body = `You usually buy this about every ${candidate.average_gap_days} days, and today lines up with your usual repurchase timing.`;
  } else if (candidate.status === 'overdue') {
    title = `${itemName} may already be due`;
    body = `You usually buy this about every ${candidate.average_gap_days} days, and you are about ${Math.abs(candidate.days_until_due)} days past the usual repurchase window.`;
  }

  return {
    id: `recurring_repurchase_due:${candidate.group_key}:${candidate.next_expected_date}`,
    type: 'recurring_repurchase_due',
    title,
    body,
    severity: candidate.status === 'overdue' || candidate.days_until_due <= 1 ? 'high' : 'medium',
    entity_type: 'item',
    entity_id: candidate.group_key,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: {
      ...candidate,
      scope: 'household',
    },
    actions: [],
  };
}

function toBuySoonBetterPriceInsight(opportunity) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const itemName = opportunity.item_name || 'A recurring item';
  const title = `${itemName} is cheaper right now`;
  const body = `${opportunity.merchant} is ${opportunity.discount_percent}% below your usual ${opportunity.comparison_type === 'unit_price' ? 'unit price' : 'price'}, and this item may be due in ${Math.max(opportunity.days_until_due, 0)} days.`;

  return {
    id: `buy_soon_better_price:${opportunity.group_key}:${opportunity.merchant}:${`${opportunity.observed_at}`.slice(0, 10)}`,
    type: 'buy_soon_better_price',
    title,
    body,
    severity: opportunity.discount_percent >= 12 || opportunity.savings_amount >= 4 ? 'high' : 'medium',
    entity_type: 'item',
    entity_id: opportunity.group_key,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: {
      ...opportunity,
      scope: 'household',
    },
    actions: [],
  };
}

function remainingDaysInPeriod(projection) {
  const daysInPeriod = Number(projection?.period?.days_in_period || 0);
  const dayIndex = Number(projection?.period?.day_index || 0);
  if (!daysInPeriod || !dayIndex) return null;
  return Math.max(daysInPeriod - dayIndex, 0);
}

function periodProgress(projection) {
  const daysInPeriod = Number(projection?.period?.days_in_period || 0);
  const dayIndex = Number(projection?.period?.day_index || 0);
  if (!daysInPeriod || !dayIndex) return null;
  return dayIndex / daysInPeriod;
}

function shouldSurfacePositiveOpportunity(projection, {
  minRemainingDays = 4,
  minProgress = 0.15,
  maxProgress = 0.9,
} = {}) {
  const overall = projection?.overall;
  const historicalPeriodCount = Number(overall?.historical_period_count || 0);
  const confidence = `${overall?.confidence || ''}`.trim();
  const remainingDays = remainingDaysInPeriod(projection);
  const progress = periodProgress(projection);

  if (historicalPeriodCount < 3) return false;
  if (confidence === 'low') return false;
  if (remainingDays == null || remainingDays < minRemainingDays) return false;
  if (progress == null || progress < minProgress || progress > maxProgress) return false;
  return true;
}

function buildRestockWindowInsights({ projection, watchCandidates = [] }) {
  const insights = [];
  const overall = projection?.overall;
  const projectedBudgetDelta = Number(overall?.projected_budget_delta || 0);
  const projectedHeadroomAmount = projectedBudgetDelta < 0 ? Math.abs(projectedBudgetDelta) : 0;
  const remainingDays = remainingDaysInPeriod(projection);
  const eligibleCandidates = (watchCandidates || [])
    .filter((candidate) => ['watching', 'due_today', 'overdue'].includes(candidate.status))
    .filter((candidate) => Number(candidate.median_amount || 0) > 0)
    .filter((candidate) => Number(candidate.occurrence_count || 0) >= 3)
    .filter((candidate) => Number(candidate.median_amount || 0) >= 12)
    .filter((candidate) => projectedHeadroomAmount >= Number(candidate.median_amount || 0) * 1.25)
    .filter((candidate) => remainingDays == null || Number(candidate.days_until_due || 0) <= remainingDays)
    .filter((candidate) => Number(candidate.days_until_due || 0) >= -3)
    .sort((a, b) => a.days_until_due - b.days_until_due || Number(b.median_amount || 0) - Number(a.median_amount || 0));

  if (
    !overall ||
    !shouldSurfacePositiveOpportunity(projection, { minRemainingDays: 3, minProgress: 0.15, maxProgress: 0.92 }) ||
    projectedHeadroomAmount < 40 ||
    !eligibleCandidates.length
  ) {
    return insights;
  }

  const candidate = eligibleCandidates[0];
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const itemName = candidate.item_name || 'A recurring item';

  insights.push({
    id: `recurring_restock_window:${candidate.group_key}:${projection.month}`,
    type: 'recurring_restock_window',
    title: `${itemName} could fit this month`,
    body: `You are projected to finish about $${projectedHeadroomAmount.toFixed(0)} under budget, and ${itemName} may be due in ${Math.max(Number(candidate.days_until_due || 0), 0)} days.`,
    severity: projectedHeadroomAmount >= Number(candidate.median_amount || 0) * 2 ? 'medium' : 'low',
    entity_type: 'item',
    entity_id: candidate.group_key,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: {
      ...candidate,
      scope: 'household',
      month: projection.month,
      projected_headroom_amount: projectedHeadroomAmount,
      projected_budget_delta: projectedBudgetDelta,
      projection_confidence: overall.confidence,
    },
    actions: [],
  });

  return insights;
}

function paceInsightType(deltaPercent) {
  return Number(deltaPercent || 0) >= 0 ? 'spend_pace_ahead' : 'spend_pace_behind';
}

function severityForTrend(type, deltaPercent) {
  const pct = Math.abs(Number(deltaPercent || 0));
  if ((type === 'spend_pace_ahead' || type === 'budget_too_low') && pct >= 20) return 'high';
  if (pct >= 10) return 'medium';
  return 'low';
}

function buildTrendInsights(trend, scope) {
  const insights = [];
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const scopeLabel = scope === 'household' ? 'household' : 'personal';

  const deltaPercent = Number(trend?.pace?.delta_percent || 0);
  const currentSpendToDate = Number(trend?.pace?.current_spend_to_date || 0);
  const historicalSpendToDateAvg = Number(trend?.pace?.historical_spend_to_date_avg || 0);
  const paceHistoryCount = Number(trend?.pace?.historical_period_count || 0);
  if (historicalSpendToDateAvg > 0 && paceHistoryCount >= 3 && Math.abs(deltaPercent) >= 10) {
    const type = paceInsightType(deltaPercent);
    insights.push({
      id: `${type}:${scopeLabel}:${trend.month}`,
      type,
      title: deltaPercent >= 0 ? 'You are spending faster than usual' : 'You are spending slower than usual',
      body: deltaPercent >= 0
        ? `You are ${Math.abs(deltaPercent)}% ahead of your usual ${scopeLabel} pace for this point in the period.`
        : `You are ${Math.abs(deltaPercent)}% below your usual ${scopeLabel} pace for this point in the period.`,
      severity: severityForTrend(type, deltaPercent),
      entity_type: 'budget_period',
      entity_id: `${scopeLabel}:${trend.month}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: trend.month,
        current_spend_to_date: currentSpendToDate,
        historical_spend_to_date_avg: historicalSpendToDateAvg,
        historical_period_count: paceHistoryCount,
        delta_amount: Number(trend?.pace?.delta_amount || 0),
        delta_percent: deltaPercent,
        projected_period_total: Number(trend?.pace?.projected_period_total || 0),
        maturity: 'mature',
        confidence: 'comparative',
        continuity_key: `budget_pace:${scopeLabel}:${trend.month}`,
      },
      actions: [],
    });
  }

  const topDriver = trend?.pace?.top_drivers?.[0];
  if (paceHistoryCount >= 3 && topDriver && Math.abs(Number(topDriver.delta_amount || 0)) >= 20) {
    const driverDirection = Number(topDriver.delta_amount) >= 0 ? 'higher' : 'lower';
    insights.push({
      id: `top_driver:${scopeLabel}:${trend.month}:${topDriver.category_key}`,
      type: 'top_category_driver',
      title: `${topDriver.category_name} is driving the difference`,
      body: Number(topDriver.delta_amount) >= 0
        ? `${topDriver.category_name} is running $${Math.abs(Number(topDriver.delta_amount)).toFixed(0)} higher than your usual ${scopeLabel} pace so far this period.`
        : `${topDriver.category_name} is running $${Math.abs(Number(topDriver.delta_amount)).toFixed(0)} lower than your usual ${scopeLabel} pace so far this period.`,
      severity: severityForTrend('top_category_driver', topDriver.delta_percent || topDriver.delta_amount),
      entity_type: 'category',
      entity_id: topDriver.category_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: trend.month,
        direction: driverDirection,
        maturity: 'mature',
        confidence: 'comparative',
        continuity_key: `category:${scopeLabel}:${topDriver.category_key}`,
        ...topDriver,
      },
      actions: [],
    });
  }

  const varianceBreakdown = trend?.pace?.variance_breakdown;
  const oneOffDeltaAmount = Number(varianceBreakdown?.one_off_delta_amount || 0);
  const recurringDeltaAmount = Number(varianceBreakdown?.recurring_delta_amount || 0);
  const topOneOffMerchants = varianceBreakdown?.top_one_off_merchants || [];
  if (
    paceHistoryCount >= 3 &&
    oneOffDeltaAmount >= 50 &&
    oneOffDeltaAmount > recurringDeltaAmount * 1.25
  ) {
    const merchantNames = topOneOffMerchants.slice(0, 2).map((merchant) => merchant.merchant_name);
    insights.push({
      id: `one_offs:${scopeLabel}:${trend.month}:${merchantNames.join('|') || 'variance'}`,
      type: 'one_offs_driving_variance',
      title: 'One-off purchases are driving the difference',
      body: merchantNames.length
        ? `${merchantNames.join(' and ')} are accounting for most of the extra ${scopeLabel} spend versus your usual pace so far this period.`
        : `A few unusual purchases are accounting for most of the extra ${scopeLabel} spend versus your usual pace so far this period.`,
      severity: oneOffDeltaAmount >= 100 ? 'high' : 'medium',
      entity_type: 'budget_period',
      entity_id: `${scopeLabel}:${trend.month}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: trend.month,
        one_off_delta_amount: oneOffDeltaAmount,
        recurring_delta_amount: recurringDeltaAmount,
        top_one_off_merchants: topOneOffMerchants,
      },
      actions: [],
    });
  }

  const budgetFit = trend?.budget_adherence?.budget_fit;
  const budgetLimit = Number(trend?.budget_adherence?.budget_limit || 0);
  const averageActualSpend = Number(trend?.budget_adherence?.average_actual_spend_last_6 || 0);
  const budgetHistoryCount = Number(trend?.budget_adherence?.historical_period_count || 0);
  if ((budgetFit === 'too_low' || budgetFit === 'too_high') && budgetLimit > 0 && averageActualSpend > 0 && budgetHistoryCount >= 4) {
    const deltaPercentBudget = Number((((averageActualSpend - budgetLimit) / budgetLimit) * 100).toFixed(1));
    insights.push({
      id: `${budgetFit}:${scopeLabel}:${trend.month}`,
      type: `budget_${budgetFit}`,
      title: budgetFit === 'too_low'
        ? `Your ${scopeLabel} budget may be too low`
        : `Your ${scopeLabel} budget may be higher than you need`,
      body: budgetFit === 'too_low'
        ? `You have gone over this ${scopeLabel} budget in ${trend.budget_adherence.over_budget_periods_last_6} of the last ${budgetHistoryCount} periods.`
        : `You have stayed well under this ${scopeLabel} budget in ${trend.budget_adherence.under_budget_periods_last_6} of the last ${budgetHistoryCount} periods.`,
      severity: severityForTrend(`budget_${budgetFit}`, deltaPercentBudget),
      entity_type: 'budget',
      entity_id: `${scopeLabel}:total`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: trend.month,
        budget_limit: budgetLimit,
        average_actual_spend_last_6: averageActualSpend,
        projected_over_under: Number(trend?.budget_adherence?.projected_over_under || 0),
        over_budget_periods_last_6: Number(trend?.budget_adherence?.over_budget_periods_last_6 || 0),
        under_budget_periods_last_6: Number(trend?.budget_adherence?.under_budget_periods_last_6 || 0),
        historical_period_count: budgetHistoryCount,
        budget_fit: budgetFit,
        maturity: 'mature',
        confidence: 'comparative',
      },
      actions: [],
    });
  }

  return insights;
}

function buildProjectionInsights(projection, scope) {
  const insights = [];
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const scopeLabel = scope === 'household' ? 'household' : 'personal';
  const overall = projection?.overall;

  if (!overall) return insights;

  const projectedBudgetDelta = Number(overall.projected_budget_delta || 0);
  const adjustedProjectedTotal = Number(overall.adjusted_projected_total || 0);
  const unusualSpendShare = Number(overall.unusual_spend_share || 0);
  const unusualSpendToDate = Number(overall.unusual_spend_to_date || 0);
  const historicalPeriodCount = Number(overall.historical_period_count || 0);

  if (
    historicalPeriodCount >= 3 &&
    adjustedProjectedTotal > 0 &&
    projectedBudgetDelta >= 50
  ) {
    insights.push({
      id: `projected_over_budget:${scopeLabel}:${projection.month}`,
      type: 'projected_month_end_over_budget',
      title: `Your ${scopeLabel} spending is projected to finish high`,
      body: `Based on your historical spend shape so far this period, you are on track to finish about $${Math.abs(projectedBudgetDelta).toFixed(0)} above budget by month end.`,
      severity: projectedBudgetDelta >= 125 ? 'high' : 'medium',
      entity_type: 'budget',
      entity_id: `${scopeLabel}:total`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection.month,
        adjusted_projected_total: adjustedProjectedTotal,
        baseline_projected_total: Number(overall.baseline_projected_total || 0),
        projected_budget_delta: projectedBudgetDelta,
        confidence: overall.confidence,
        historical_period_count: historicalPeriodCount,
        maturity: 'mature',
        continuity_key: `budget_pace:${scopeLabel}:${projection.month}`,
      },
      actions: [],
    });
  }

  if (
    historicalPeriodCount >= 3 &&
    adjustedProjectedTotal > 0 &&
    projectedBudgetDelta <= -40 &&
    shouldSurfacePositiveOpportunity(projection)
  ) {
    insights.push({
      id: `projected_under_budget:${scopeLabel}:${projection.month}`,
      type: 'projected_month_end_under_budget',
      title: `Your ${scopeLabel} spending has room this period`,
      body: `Based on your historical spend shape so far this period, you are on track to finish about $${Math.abs(projectedBudgetDelta).toFixed(0)} under budget by month end.`,
      severity: Math.abs(projectedBudgetDelta) >= 100 ? 'medium' : 'low',
      entity_type: 'budget',
      entity_id: `${scopeLabel}:total`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection.month,
        adjusted_projected_total: adjustedProjectedTotal,
        baseline_projected_total: Number(overall.baseline_projected_total || 0),
        projected_budget_delta: projectedBudgetDelta,
        projected_headroom_amount: Math.abs(projectedBudgetDelta),
        confidence: overall.confidence,
        historical_period_count: historicalPeriodCount,
        maturity: 'mature',
        continuity_key: `budget_pace:${scopeLabel}:${projection.month}`,
      },
      actions: [],
    });
  }

  if (
    historicalPeriodCount >= 3 &&
    unusualSpendToDate >= 75 &&
    unusualSpendShare >= 0.35 &&
    overall.top_unusual_expenses?.length
  ) {
    const topExpense = overall.top_unusual_expenses[0];
    insights.push({
      id: `projection_one_off:${scopeLabel}:${projection.month}:${topExpense.id || topExpense.merchant}`,
      type: 'one_off_expense_skewing_projection',
      title: 'One unusual purchase is skewing the projection',
      body: `${topExpense.merchant} is contributing a meaningful share of this month’s projected overage, so your baseline spend is more normal than the all-in projection suggests.`,
      severity: unusualSpendShare >= 0.55 ? 'high' : 'medium',
      entity_type: 'expense',
      entity_id: topExpense.id || `${scopeLabel}:${projection.month}:${topExpense.merchant}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection.month,
        unusual_spend_to_date: unusualSpendToDate,
        unusual_spend_share: unusualSpendShare,
        top_unusual_expense: topExpense,
        adjusted_projected_total: adjustedProjectedTotal,
        baseline_projected_total: Number(overall.baseline_projected_total || 0),
        confidence: overall.confidence,
      },
      actions: [],
    });
  }

  const topCategoryProjection = (projection?.categories || [])
    .filter((category) => Number(category.historical_period_count || 0) >= 3)
    .map((category) => {
      const adjusted = Number(category.adjusted_projected_total || 0);
      const historicalAverage = Number(category.historical_average_total || 0);
      const deltaAmount = adjusted - historicalAverage;
      const deltaPercent = historicalAverage > 0 ? (deltaAmount / historicalAverage) * 100 : 0;
      return {
        ...category,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
        historical_average_total: historicalAverage,
      };
    })
    .filter((category) => Number(category.adjusted_projected_total || 0) > 0)
    .sort((a, b) => Number(b.delta_amount || 0) - Number(a.delta_amount || 0))[0];

  if (
    topCategoryProjection &&
    Number(topCategoryProjection.delta_amount || 0) >= 15 &&
    Number(topCategoryProjection.delta_percent || 0) >= 10
  ) {
    insights.push({
      id: `projected_category_surge:${scopeLabel}:${projection.month}:${topCategoryProjection.category_key}`,
      type: 'projected_category_surge',
      title: `${topCategoryProjection.category_name} is projected to finish high`,
      body: `${topCategoryProjection.category_name} is on track to finish about $${Math.abs(Number(topCategoryProjection.delta_amount || 0)).toFixed(0)} above its baseline pace for this period.`,
      severity: Number(topCategoryProjection.delta_amount || 0) >= 60 ? 'high' : 'medium',
      entity_type: 'category',
      entity_id: topCategoryProjection.category_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection.month,
        category_key: topCategoryProjection.category_key,
        category_name: topCategoryProjection.category_name,
        adjusted_projected_total: Number(topCategoryProjection.adjusted_projected_total || 0),
        baseline_projected_total: Number(topCategoryProjection.baseline_projected_total || 0),
        historical_average_total: Number(topCategoryProjection.historical_average_total || 0),
        unusual_spend_to_date: Number(topCategoryProjection.unusual_spend_to_date || 0),
        delta_amount: Number(topCategoryProjection.delta_amount || 0),
        delta_percent: Number(topCategoryProjection.delta_percent || 0),
        confidence: topCategoryProjection.confidence,
        historical_period_count: Number(topCategoryProjection.historical_period_count || 0),
        maturity: 'mature',
        continuity_key: `category:${scopeLabel}:${topCategoryProjection.category_key}`,
      },
      actions: [],
    });
  }

  const lowestCategoryProjection = (projection?.categories || [])
    .filter((category) => Number(category.historical_period_count || 0) >= 3)
    .map((category) => {
      const adjusted = Number(category.adjusted_projected_total || 0);
      const historicalAverage = Number(category.historical_average_total || 0);
      const deltaAmount = adjusted - historicalAverage;
      const deltaPercent = historicalAverage > 0 ? (deltaAmount / historicalAverage) * 100 : 0;
      return {
        ...category,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
        historical_average_total: historicalAverage,
      };
    })
    .filter((category) => Number(category.adjusted_projected_total || 0) > 0)
    .sort((a, b) => Number(a.delta_amount || 0) - Number(b.delta_amount || 0))[0];

  if (
    lowestCategoryProjection &&
    Number(lowestCategoryProjection.delta_amount || 0) <= -15 &&
    Number(lowestCategoryProjection.delta_percent || 0) <= -10 &&
    Number(lowestCategoryProjection.unusual_spend_to_date || 0) <= 0 &&
    shouldSurfacePositiveOpportunity(projection, { minRemainingDays: 4, minProgress: 0.15, maxProgress: 0.88 })
  ) {
    insights.push({
      id: `projected_category_under:${scopeLabel}:${projection.month}:${lowestCategoryProjection.category_key}`,
      type: 'projected_category_under_baseline',
      title: `${lowestCategoryProjection.category_name} has room this period`,
      body: `${lowestCategoryProjection.category_name} is on track to finish about $${Math.abs(Number(lowestCategoryProjection.delta_amount || 0)).toFixed(0)} below its usual finish this period.`,
      severity: Math.abs(Number(lowestCategoryProjection.delta_amount || 0)) >= 40 ? 'medium' : 'low',
      entity_type: 'category',
      entity_id: lowestCategoryProjection.category_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection.month,
        category_key: lowestCategoryProjection.category_key,
        category_name: lowestCategoryProjection.category_name,
        adjusted_projected_total: Number(lowestCategoryProjection.adjusted_projected_total || 0),
        baseline_projected_total: Number(lowestCategoryProjection.baseline_projected_total || 0),
        historical_average_total: Number(lowestCategoryProjection.historical_average_total || 0),
        projected_headroom_amount: Math.abs(Number(lowestCategoryProjection.delta_amount || 0)),
        delta_amount: Number(lowestCategoryProjection.delta_amount || 0),
        delta_percent: Number(lowestCategoryProjection.delta_percent || 0),
        confidence: lowestCategoryProjection.confidence,
        historical_period_count: Number(lowestCategoryProjection.historical_period_count || 0),
        maturity: 'mature',
        continuity_key: `category:${scopeLabel}:${lowestCategoryProjection.category_key}`,
      },
      actions: [],
    });
  }

  return insights;
}

function earlyInsightMetadata(projection, scopeLabel, extra = {}) {
  return {
    scope: scopeLabel,
    month: projection?.month || null,
    maturity: 'early',
    confidence: 'descriptive',
    history_stage: projection?.overall?.history_stage || 'none',
    historical_period_count: Number(projection?.overall?.historical_period_count || 0),
    ...extra,
  };
}

function buildEarlyUsageInsights({ projection, budgetLimit = null, scope = 'personal' }) {
  const insights = [];
  const activity = projection?.current_activity || {};
  const overall = projection?.overall || {};
  const historicalPeriodCount = Number(overall.historical_period_count || 0);
  const expenseCount = Number(activity.expense_count || 0);
  const totalSpend = Number(activity.total_spend || overall.current_spend_to_date || 0);
  const scopeLabel = scope === 'household' ? 'household' : 'personal';
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

  if (historicalPeriodCount >= 3 || expenseCount <= 0 || totalSpend <= 0) {
    return insights;
  }

  const period = projection?.period || {};
  const dayIndex = Number(period.day_index || 0);
  const daysInPeriod = Number(period.days_in_period || 0);
  const daysRemaining = daysInPeriod && dayIndex ? Math.max(daysInPeriod - dayIndex, 0) : null;
  const periodShare = daysInPeriod && dayIndex ? dayIndex / daysInPeriod : null;
  const activeDayCount = Number(activity.active_day_count || 0);
  const topCategory = activity.top_categories?.[0];
  const topMerchant = activity.top_merchants?.find((merchant) => Number(merchant.count || 0) >= 2);
  const largestExpense = activity.largest_expense;

  if (Number(budgetLimit) > 0) {
    const budgetUsedPercent = Number(((totalSpend / Number(budgetLimit)) * 100).toFixed(1));
    const expectedUsedPercent = periodShare == null ? null : Number((periodShare * 100).toFixed(1));
    const paceIsTight = expectedUsedPercent != null && budgetUsedPercent >= expectedUsedPercent + 15 && totalSpend >= Number(budgetLimit) * 0.2;
    insights.push({
      id: `early_budget_pace:${scopeLabel}:${projection.month}:${Math.round(totalSpend)}:${Math.round(Number(budgetLimit))}`,
      type: 'early_budget_pace',
      title: `Early ${scopeLabel} budget read`,
      body: daysRemaining == null
        ? `You have used ${budgetUsedPercent}% of your ${scopeLabel} budget so far.`
        : `You have used ${budgetUsedPercent}% of your ${scopeLabel} budget with ${daysRemaining} days left in this period.`,
      severity: paceIsTight ? 'medium' : 'low',
      entity_type: 'budget',
      entity_id: `${scopeLabel}:total`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        budget_limit: Number(budgetLimit),
        current_spend_to_date: totalSpend,
        budget_used_percent: budgetUsedPercent,
        expected_used_percent: expectedUsedPercent,
        days_remaining: daysRemaining,
        continuity_key: `budget_pace:${scopeLabel}:${projection.month}`,
      }),
      actions: [],
    });
  }

  if (topCategory && Number(topCategory.spend || 0) >= Math.max(20, totalSpend * 0.35) && expenseCount >= 3) {
    const share = Number(((Number(topCategory.spend || 0) / totalSpend) * 100).toFixed(1));
    insights.push({
      id: `early_top_category:${scopeLabel}:${projection.month}:${topCategory.category_key}:${Math.round(Number(topCategory.spend || 0))}`,
      type: 'early_top_category',
      title: `${topCategory.category_name} is leading so far`,
      body: `${topCategory.category_name} accounts for ${share}% of your ${scopeLabel} spending in this period so far.`,
      severity: share >= 55 ? 'medium' : 'low',
      entity_type: 'category',
      entity_id: topCategory.category_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        category_key: topCategory.category_key,
        category_name: topCategory.category_name,
        category_spend: Number(topCategory.spend || 0),
        category_count: Number(topCategory.count || 0),
        share_of_spend: share,
        continuity_key: `category:${scopeLabel}:${topCategory.category_key}`,
      }),
      actions: [],
    });
  }

  if (topMerchant && Number(topMerchant.spend || 0) >= 15) {
    insights.push({
      id: `early_repeated_merchant:${scopeLabel}:${projection.month}:${topMerchant.merchant_key}:${topMerchant.count}`,
      type: 'early_repeated_merchant',
      title: `${topMerchant.merchant_name} is showing up repeatedly`,
      body: `${topMerchant.merchant_name} has appeared ${topMerchant.count} times in your ${scopeLabel} spending this period.`,
      severity: Number(topMerchant.count || 0) >= 3 ? 'medium' : 'low',
      entity_type: 'merchant',
      entity_id: topMerchant.merchant_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        merchant_key: topMerchant.merchant_key,
        merchant_name: topMerchant.merchant_name,
        merchant_spend: Number(topMerchant.spend || 0),
        merchant_count: Number(topMerchant.count || 0),
        continuity_key: `merchant:${scopeLabel}:${topMerchant.merchant_key}`,
      }),
      actions: [],
    });
  }

  if (largestExpense && expenseCount >= 3 && Number(largestExpense.share_of_spend || 0) >= 0.35 && Math.abs(Number(largestExpense.amount || 0)) >= 25) {
    const share = Number((Number(largestExpense.share_of_spend || 0) * 100).toFixed(1));
    insights.push({
      id: `early_spend_concentration:${scopeLabel}:${projection.month}:${largestExpense.id || largestExpense.merchant}:${Math.round(Number(largestExpense.amount || 0))}`,
      type: 'early_spend_concentration',
      title: 'One purchase is shaping the early read',
      body: `${largestExpense.merchant} accounts for ${share}% of your ${scopeLabel} spending so far this period.`,
      severity: share >= 50 ? 'medium' : 'low',
      entity_type: 'expense',
      entity_id: largestExpense.id || `${scopeLabel}:${projection.month}:${largestExpense.merchant}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        largest_expense: largestExpense,
        share_of_spend: share,
      }),
      actions: [],
    });
  }

  if (Number(activity.uncategorized_count || 0) >= 2) {
    insights.push({
      id: `early_cleanup:${scopeLabel}:${projection.month}:uncategorized:${activity.uncategorized_count}`,
      type: 'early_cleanup',
      title: 'A little cleanup will sharpen guidance',
      body: `${activity.uncategorized_count} expenses are uncategorized, which makes early guidance less specific.`,
      severity: 'low',
      entity_type: 'category',
      entity_id: 'uncategorized',
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        uncategorized_count: Number(activity.uncategorized_count || 0),
      }),
      actions: [],
    });
  }

  if (activeDayCount >= 3 && expenseCount >= 5) {
    insights.push({
      id: `early_logging_momentum:${scopeLabel}:${projection.month}:${activeDayCount}:${expenseCount}`,
      type: 'early_logging_momentum',
      title: 'Your baseline is starting to form',
      body: `You have logged ${expenseCount} expenses across ${activeDayCount} days this period. The next insights can get more tailored from here.`,
      severity: 'low',
      entity_type: 'budget_period',
      entity_id: `${scopeLabel}:${projection.month}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: earlyInsightMetadata(projection, scopeLabel, {
        expense_count: expenseCount,
        active_day_count: activeDayCount,
      }),
      actions: [],
    });
  }

  return insights.slice(0, 4);
}

function maturityRankForInsight(insight) {
  const maturity = `${insight?.metadata?.maturity || ''}`.trim();
  if (maturity === 'mature') return 3;
  if (maturity === 'developing') return 2;
  if (maturity === 'early') return 1;
  return 0;
}

function insightContinuityKey(insight) {
  if (insight?.metadata?.continuity_key) return insight.metadata.continuity_key;

  const type = `${insight?.type || ''}`.trim();
  const scope = insight?.metadata?.scope || 'global';
  const month = insight?.metadata?.month || 'current';

  if (
    type === 'early_top_category'
    || type === 'developing_category_shift'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
  ) {
    const categoryKey = insight?.metadata?.category_key || insight?.entity_id;
    return categoryKey ? `category:${scope}:${categoryKey}` : null;
  }

  if (
    type === 'early_repeated_merchant'
    || type === 'developing_repeated_merchant'
  ) {
    const merchantKey = insight?.metadata?.merchant_key || insight?.entity_id;
    return merchantKey ? `merchant:${scope}:${merchantKey}` : null;
  }

  if (
    type === 'early_budget_pace'
    || type === 'developing_weekly_spend_change'
    || type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
  ) {
    return `budget_pace:${scope}:${month}`;
  }

  return null;
}

function summarizeExpenseRows(rows = []) {
  const byCategory = new Map();
  const byMerchant = new Map();
  const dates = new Set();
  let totalSpend = 0;

  for (const row of rows || []) {
    const amount = Number(row.amount || row.spend || 0);
    totalSpend += amount;
    if (row.date) dates.add(`${row.date}`.slice(0, 10));

    const categoryKey = row.category_key || 'uncategorized';
    const category = byCategory.get(categoryKey) || {
      category_key: categoryKey,
      category_name: row.category_name || 'Uncategorized',
      spend: 0,
      count: 0,
    };
    category.spend += amount;
    category.count += 1;
    byCategory.set(categoryKey, category);

    const merchantKey = `${row.merchant_key || row.merchant || 'unknown'}`.trim().toLowerCase() || 'unknown';
    const merchant = byMerchant.get(merchantKey) || {
      merchant_key: merchantKey,
      merchant_name: row.merchant_name || row.merchant || 'Unknown',
      spend: 0,
      count: 0,
    };
    merchant.spend += amount;
    merchant.count += 1;
    byMerchant.set(merchantKey, merchant);
  }

  const sortBySpend = (a, b) => Number(b.spend || 0) - Number(a.spend || 0) || Number(b.count || 0) - Number(a.count || 0);

  return {
    expense_count: rows.length,
    active_day_count: dates.size,
    total_spend: Number(totalSpend.toFixed(2)),
    top_categories: [...byCategory.values()]
      .map((entry) => ({ ...entry, spend: Number(entry.spend.toFixed(2)) }))
      .sort(sortBySpend)
      .slice(0, 5),
    top_merchants: [...byMerchant.values()]
      .map((entry) => ({ ...entry, spend: Number(entry.spend.toFixed(2)) }))
      .sort(sortBySpend)
      .slice(0, 5),
  };
}

async function listRollingExpenses({ user, scope = 'personal', from, toExclusive }) {
  const effectiveScope = scope === 'household' && user?.household_id ? 'household' : 'personal';
  if (effectiveScope === 'household') {
    const result = await db.query(
      `SELECT
         e.merchant,
         COALESCE(NULLIF(TRIM(LOWER(e.merchant)), ''), 'unknown') AS merchant_key,
         COALESCE(NULLIF(TRIM(e.merchant), ''), 'Unknown') AS merchant_name,
         e.amount,
         e.date,
         COALESCE(e.category_id::text, 'uncategorized') AS category_key,
         COALESCE(pc.name || ' · ' || c.name, c.name, 'Uncategorized') AS category_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       LEFT JOIN categories pc ON c.parent_id = pc.id
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND e.status = 'confirmed'
         AND e.date >= $2
         AND e.date < $3`,
      [user.household_id, from, toExclusive]
    );
    return result.rows;
  }

  const result = await db.query(
    `SELECT
       e.merchant,
       COALESCE(NULLIF(TRIM(LOWER(e.merchant)), ''), 'unknown') AS merchant_key,
       COALESCE(NULLIF(TRIM(e.merchant), ''), 'Unknown') AS merchant_name,
       e.amount,
       e.date,
       COALESCE(e.category_id::text, 'uncategorized') AS category_key,
       COALESCE(pc.name || ' · ' || c.name, c.name, 'Uncategorized') AS category_name
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     LEFT JOIN categories pc ON c.parent_id = pc.id
     WHERE e.user_id = $1
       AND e.status = 'confirmed'
       AND e.date >= $2
       AND e.date < $3`,
    [user.id, from, toExclusive]
  );
  return result.rows;
}

async function analyzeRollingActivity({ user, scope = 'personal', days = 7 }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentTo = dateOnly(addDays(today, 1));
  const currentFrom = dateOnly(addDays(today, -Math.max(Number(days) || 7, 1) + 1));
  const previousTo = currentFrom;
  const previousFrom = dateOnly(addDays(today, -Math.max(Number(days) || 7, 1) * 2 + 1));

  const [currentRows, previousRows] = await Promise.all([
    listRollingExpenses({ user, scope, from: currentFrom, toExclusive: currentTo }),
    listRollingExpenses({ user, scope, from: previousFrom, toExclusive: previousTo }),
  ]);

  return {
    scope: scope === 'household' && user?.household_id ? 'household' : 'personal',
    days: Math.max(Number(days) || 7, 1),
    current_window: {
      from: currentFrom,
      to: currentTo,
      ...summarizeExpenseRows(currentRows),
    },
    previous_window: {
      from: previousFrom,
      to: previousTo,
      ...summarizeExpenseRows(previousRows),
    },
  };
}

function developingInsightMetadata(rollingActivity, scopeLabel, extra = {}) {
  return {
    scope: scopeLabel,
    maturity: 'developing',
    confidence: 'directional',
    window_days: Number(rollingActivity?.days || 7),
    current_window: {
      from: rollingActivity?.current_window?.from || null,
      to: rollingActivity?.current_window?.to || null,
    },
    previous_window: {
      from: rollingActivity?.previous_window?.from || null,
      to: rollingActivity?.previous_window?.to || null,
    },
    ...extra,
  };
}

function buildDevelopingUsageInsights({ rollingActivity, projection = null, scope = 'personal' }) {
  const insights = [];
  const current = rollingActivity?.current_window || {};
  const previous = rollingActivity?.previous_window || {};
  const scopeLabel = scope === 'household' ? 'household' : 'personal';
  const currentSpend = Number(current.total_spend || 0);
  const previousSpend = Number(previous.total_spend || 0);
  const expenseCount = Number(current.expense_count || 0);
  const activeDayCount = Number(current.active_day_count || 0);
  const historicalPeriodCount = Number(projection?.overall?.historical_period_count || 0);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

  if (historicalPeriodCount >= 3 || expenseCount < 4 || activeDayCount < 2 || currentSpend <= 0) {
    return insights;
  }

  if (previousSpend > 0) {
    const deltaAmount = Number((currentSpend - previousSpend).toFixed(2));
    const deltaPercent = Number(((deltaAmount / previousSpend) * 100).toFixed(1));
    if (Math.abs(deltaAmount) >= 35 && Math.abs(deltaPercent) >= 30) {
      const increased = deltaAmount > 0;
      insights.push({
        id: `developing_weekly_spend_change:${scopeLabel}:${current.from}:${Math.round(currentSpend)}:${Math.round(previousSpend)}`,
        type: 'developing_weekly_spend_change',
        title: increased ? 'This week is starting heavier' : 'This week is starting lighter',
        body: increased
          ? `Your ${scopeLabel} spending in the last ${rollingActivity.days} days is about $${Math.abs(deltaAmount).toFixed(0)} higher than the prior ${rollingActivity.days} days.`
          : `Your ${scopeLabel} spending in the last ${rollingActivity.days} days is about $${Math.abs(deltaAmount).toFixed(0)} lower than the prior ${rollingActivity.days} days.`,
        severity: increased && Math.abs(deltaPercent) >= 60 ? 'medium' : 'low',
        entity_type: 'budget_period',
        entity_id: `${scopeLabel}:rolling:${current.from}`,
        created_at: createdAt,
        expires_at: expiresAt,
        metadata: developingInsightMetadata(rollingActivity, scopeLabel, {
        current_spend: currentSpend,
        previous_spend: previousSpend,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
        continuity_key: `budget_pace:${scopeLabel}:${projection?.month || 'current'}`,
      }),
      actions: [],
      });
    }
  }

  const topCategory = current.top_categories?.[0];
  const previousCategory = topCategory
    ? previous.top_categories?.find((category) => category.category_key === topCategory.category_key)
    : null;
  if (topCategory && Number(topCategory.spend || 0) >= 35 && Number(topCategory.count || 0) >= 2) {
    const priorSpend = Number(previousCategory?.spend || 0);
    const deltaAmount = Number((Number(topCategory.spend || 0) - priorSpend).toFixed(2));
    const share = Number(((Number(topCategory.spend || 0) / currentSpend) * 100).toFixed(1));
    if ((priorSpend === 0 && share >= 35) || (deltaAmount >= 25 && deltaAmount >= priorSpend * 0.5)) {
      insights.push({
        id: `developing_category_shift:${scopeLabel}:${current.from}:${topCategory.category_key}:${Math.round(Number(topCategory.spend || 0))}`,
        type: 'developing_category_shift',
        title: `${topCategory.category_name} is becoming the week’s center`,
        body: `${topCategory.category_name} is ${share}% of your ${scopeLabel} spending over the last ${rollingActivity.days} days.`,
        severity: share >= 55 ? 'medium' : 'low',
        entity_type: 'category',
        entity_id: topCategory.category_key,
        created_at: createdAt,
        expires_at: expiresAt,
        metadata: developingInsightMetadata(rollingActivity, scopeLabel, {
          category_key: topCategory.category_key,
          category_name: topCategory.category_name,
          current_spend: Number(topCategory.spend || 0),
          previous_spend: priorSpend,
          delta_amount: deltaAmount,
          share_of_spend: share,
          continuity_key: `category:${scopeLabel}:${topCategory.category_key}`,
        }),
        actions: [],
      });
    }
  }

  const repeatedMerchant = current.top_merchants?.find((merchant) =>
    Number(merchant.count || 0) >= 2 && Number(merchant.spend || 0) >= 25
  );
  if (repeatedMerchant) {
    const previousMerchant = previous.top_merchants?.find((merchant) => merchant.merchant_key === repeatedMerchant.merchant_key);
    insights.push({
      id: `developing_repeated_merchant:${scopeLabel}:${current.from}:${repeatedMerchant.merchant_key}:${repeatedMerchant.count}`,
      type: 'developing_repeated_merchant',
      title: `${repeatedMerchant.merchant_name} is forming a short-term pattern`,
      body: `${repeatedMerchant.merchant_name} has appeared ${repeatedMerchant.count} times in the last ${rollingActivity.days} days.`,
      severity: Number(repeatedMerchant.count || 0) >= 3 ? 'medium' : 'low',
      entity_type: 'merchant',
      entity_id: repeatedMerchant.merchant_key,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: developingInsightMetadata(rollingActivity, scopeLabel, {
        merchant_key: repeatedMerchant.merchant_key,
        merchant_name: repeatedMerchant.merchant_name,
        current_spend: Number(repeatedMerchant.spend || 0),
        previous_spend: Number(previousMerchant?.spend || 0),
        merchant_count: Number(repeatedMerchant.count || 0),
        continuity_key: `merchant:${scopeLabel}:${repeatedMerchant.merchant_key}`,
      }),
      actions: [],
    });
  }

  return insights.slice(0, 3);
}

function severityRank(severity) {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function insightRankScore(insight, feedbackSummary = new Map()) {
  return severityRank(insight.severity) * 100 + feedbackAdjustmentForInsight(insight, feedbackSummary);
}

function insightDestinationAdjustment(insight) {
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'recurring_cost_pressure'
  ) return 6;

  if (
    type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
  ) return 4;

  if (
    type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'budget_too_low'
    || type === 'budget_too_high'
    || type === 'usage_ready_to_plan'
  ) return 5;

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'usage_set_budget'
    || type === 'usage_start_logging'
    || type === 'usage_building_history'
  ) return 1;

  return 0;
}

function portfolioRole(insight) {
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'usage_start_logging'
    || type === 'usage_set_budget'
    || type === 'usage_building_history'
  ) return 'setup';

  if (
    type === 'projected_month_end_over_budget'
    || type === 'budget_too_low'
    || type === 'recurring_repurchase_due'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
  ) return 'act';

  if (
    type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'usage_ready_to_plan'
  ) return 'plan';

  if (
    type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'recurring_cost_pressure'
    || type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'budget_too_high'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
  ) return 'explain';

  return 'other';
}

function portfolioFamily(insight) {
  const type = `${insight?.type || ''}`.trim();
  if (!type) return 'other';

  if (
    type === 'spend_pace_ahead'
    || type === 'budget_too_low'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_category_surge'
    || type === 'recurring_price_spike'
    || type === 'recurring_cost_pressure'
  ) return 'warning';

  if (
    type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
  ) return 'explanation';

  if (
    type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
  ) return 'opportunity';

  if (
    type === 'recurring_repurchase_due'
    || type === 'spend_pace_behind'
    || type === 'budget_too_high'
  ) return 'reminder';

  return 'other';
}

function narrativeClusterKey(insight) {
  const scope = insight?.metadata?.scope || 'global';
  const month = insight?.metadata?.month || 'na';
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
  ) {
    return `trend:${scope}:${month}`;
  }

  if (
    type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'one_off_expense_skewing_projection'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
  ) {
    return `projection:${scope}:${month}`;
  }

  if (
    type === 'recurring_repurchase_due'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
    || type === 'recurring_cost_pressure'
  ) {
    return `recurring:${scope}:${month}`;
  }

  if (
    type === 'budget_too_low'
    || type === 'budget_too_high'
  ) {
    return `budget:${scope}:${month}`;
  }

  return `${type}:${scope}:${month}`;
}

function narrativeTheme(insight) {
  return narrativeClusterKey(insight).split(':')[0] || 'other';
}

function aggregatePortfolioFeedback(feedbackSummary = new Map()) {
  const family = new Map();
  const theme = new Map();

  for (const [insightType, stats] of feedbackSummary.entries()) {
    const familyKey = portfolioFamily({ type: insightType });
    const themeKey = narrativeTheme({ type: insightType });

    const addToBucket = (bucket, key) => {
      const current = bucket.get(key) || {
        shown: 0,
        helpful: 0,
        not_helpful: 0,
        dismissed: 0,
        acted: 0,
      };
      current.shown += Number(stats.shown || 0);
      current.helpful += Number(stats.helpful || 0);
      current.not_helpful += Number(stats.not_helpful || 0);
      current.dismissed += Number(stats.dismissed || 0);
      current.acted += Number(stats.acted || 0);
      bucket.set(key, current);
    };

    addToBucket(family, familyKey);
    addToBucket(theme, themeKey);
  }

  return { family, theme };
}

function portfolioBucketAdjustment(stats = {}) {
  const shown = Number(stats.shown || 0);
  const helpful = Number(stats.helpful || 0);
  const notHelpful = Number(stats.not_helpful || 0);
  const dismissed = Number(stats.dismissed || 0);
  const acted = Number(stats.acted || 0);

  let score = 0;
  score += helpful * 1.5;
  score += acted * 2.5;
  score -= notHelpful * 2;
  score -= dismissed * 1.25;

  if (shown >= 4 && acted === 0 && helpful === 0) score -= 3;
  if (shown >= 3 && acted / shown >= 0.25) score += 2;

  return score;
}

function portfolioOutcomeAdjustment(insight, portfolioFeedback = { family: new Map(), theme: new Map() }) {
  const familyStats = portfolioFeedback.family.get(portfolioFamily(insight));
  const themeStats = portfolioFeedback.theme.get(narrativeTheme(insight));
  return portfolioBucketAdjustment(familyStats) + portfolioBucketAdjustment(themeStats) * 0.75;
}

function orchestrationPenalty(insight, selected = []) {
  const family = portfolioFamily(insight);
  const sameFamilyCount = selected.filter((picked) => portfolioFamily(picked) === family).length;
  const selectedFamilies = new Set(selected.map((picked) => portfolioFamily(picked)));
  const clusterKey = narrativeClusterKey(insight);
  const sameEntityCount = selected.filter((picked) =>
    picked.entity_type === insight.entity_type
    && picked.entity_id
    && picked.entity_id === insight.entity_id
  ).length;
  const sameScopeCount = selected.filter((picked) =>
    picked.metadata?.scope
    && picked.metadata?.scope === insight.metadata?.scope
    && portfolioFamily(picked) === family
  ).length;
  const sameClusterCount = selected.filter((picked) => narrativeClusterKey(picked) === clusterKey).length;

  let penalty = 0;
  penalty += sameFamilyCount * 55;
  penalty += sameEntityCount * 35;
  penalty += sameScopeCount * 10;
  penalty += sameClusterCount * 70;

  if (sameFamilyCount > 0 && selectedFamilies.size < 3) {
    penalty += 90;
  }

  if (family === 'opportunity') penalty += sameFamilyCount * 20;
  if (family === 'explanation') penalty += sameFamilyCount * 15;

  return penalty;
}

function orchestrationRoleMixAdjustment(insight, selected = []) {
  const role = portfolioRole(insight);
  const selectedRoles = new Set(selected.map((picked) => portfolioRole(picked)));
  const sameRoleCount = selected.filter((picked) => portfolioRole(picked) === role).length;

  let score = 0;

  if (selected.length === 0) {
    if (role === 'act' || role === 'setup') score += 10;
    if (role === 'explain') score -= 4;
  }

  if (!selectedRoles.has(role)) {
    if (role === 'act' || role === 'plan' || role === 'setup') score += 14;
    else if (role === 'explain') score += 6;
  }

  if (role === 'explain' && !selectedRoles.has('act') && !selectedRoles.has('plan') && !selectedRoles.has('setup')) {
    score -= 8;
  }

  if (role === 'explain' && sameRoleCount > 0) score -= sameRoleCount * 10;
  if (role === 'setup' && sameRoleCount > 0) score -= sameRoleCount * 20;

  return score;
}

function orchestrateInsightPortfolio(insights, feedbackSummary = new Map(), limit = 10) {
  const remaining = [...insights];
  const selected = [];
  const portfolioFeedback = aggregatePortfolioFeedback(feedbackSummary);

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const insight = remaining[i];
      const score = insightRankScore(insight, feedbackSummary)
        + portfolioOutcomeAdjustment(insight, portfolioFeedback)
        + insightDestinationAdjustment(insight)
        + orchestrationRoleMixAdjustment(insight, selected)
        - orchestrationPenalty(insight, selected);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function dedupeInsights(insights) {
  const picked = new Map();
  for (const insight of insights) {
    const key = (() => {
      if (insight.type === 'spend_pace_ahead' || insight.type === 'spend_pace_behind') {
        return [
          insight.type,
          insight.metadata?.month,
          insight.metadata?.delta_percent,
          insight.metadata?.current_spend_to_date,
          insight.metadata?.historical_spend_to_date_avg,
        ].join(':');
      }
      if (insight.type === 'budget_too_low' || insight.type === 'budget_too_high') {
        return [
          insight.type,
          insight.metadata?.month,
          insight.metadata?.budget_limit,
          insight.metadata?.average_actual_spend_last_6,
          insight.metadata?.historical_period_count,
        ].join(':');
      }
      if (insight.type === 'top_category_driver') {
        return [
          insight.type,
          insight.metadata?.month,
          insight.metadata?.category_key,
          insight.metadata?.delta_amount,
        ].join(':');
      }
      if (insight.type === 'one_offs_driving_variance') {
        return [
          insight.type,
          insight.metadata?.month,
          insight.metadata?.one_off_delta_amount,
          (insight.metadata?.top_one_off_merchants || []).map((merchant) => merchant.merchant_key).join('|'),
        ].join(':');
      }
      if (insight.type === 'recurring_repurchase_due') {
        return [
          insight.type,
          insight.metadata?.group_key,
          insight.metadata?.next_expected_date,
        ].join(':');
      }
      return `${insight.title}:${insight.body}`;
    })();
    const existing = picked.get(key);
    if (!existing) {
      picked.set(key, insight);
      continue;
    }
    const existingRank = severityRank(existing.severity);
    const incomingRank = severityRank(insight.severity);
    if (incomingRank > existingRank) {
      picked.set(key, insight);
      continue;
    }
    if (incomingRank === existingRank && new Date(insight.created_at) > new Date(existing.created_at)) {
      picked.set(key, insight);
    }
  }
  return [...picked.values()];
}

function resolveOpportunityCompetition(insights) {
  const byType = new Map(insights.map((insight) => [insight.id, insight]));
  const removals = new Set();

  const restockWindows = insights.filter((insight) => insight.type === 'recurring_restock_window');
  for (const restock of restockWindows) {
    const scope = restock.metadata?.scope;
    const month = restock.metadata?.month;
    if (!scope || !month) continue;

    for (const insight of insights) {
      if (insight.id === restock.id) continue;
      if (insight.metadata?.scope !== scope || insight.metadata?.month !== month) continue;

      if (insight.type === 'projected_month_end_under_budget') {
        removals.add(insight.id);
      }

      if (
        insight.type === 'projected_category_under_baseline' &&
        insight.metadata?.category_key === restock.metadata?.category_key
      ) {
        removals.add(insight.id);
      }
    }
  }

  const categoryHeadroom = insights.filter((insight) => insight.type === 'projected_category_under_baseline');
  for (const categoryInsight of categoryHeadroom) {
    const scope = categoryInsight.metadata?.scope;
    const month = categoryInsight.metadata?.month;
    if (!scope || !month) continue;

    const generic = insights.find((insight) =>
      insight.type === 'projected_month_end_under_budget'
      && insight.metadata?.scope === scope
      && insight.metadata?.month === month
    );
    if (generic) {
      removals.add(generic.id);
    }
  }

  return insights.filter((insight) => !removals.has(insight.id) && byType.has(insight.id));
}

function resolveMaturityCompetition(insights) {
  const grouped = new Map();
  const passthrough = [];

  for (const insight of insights || []) {
    const key = insightContinuityKey(insight);
    const rank = maturityRankForInsight(insight);
    if (!key || rank <= 0) {
      passthrough.push(insight);
      continue;
    }

    const group = grouped.get(key) || [];
    group.push(insight);
    grouped.set(key, group);
  }

  const resolved = [];
  for (const group of grouped.values()) {
    const maxRank = group.reduce((max, insight) => Math.max(max, maturityRankForInsight(insight)), 0);
    const winners = group
      .filter((insight) => maturityRankForInsight(insight) === maxRank)
      .sort((a, b) =>
        severityRank(b.severity) - severityRank(a.severity)
        || insightDestinationAdjustment(b) - insightDestinationAdjustment(a)
        || new Date(b.created_at) - new Date(a.created_at)
      );

    resolved.push(winners[0]);
  }

  return [...passthrough, ...resolved];
}

function buildUsageFallbackInsights({ user, projection, budgetLimit = null, scope = 'personal', context = 'default' }) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const projectionOverall = projection?.overall || {};
  const historicalPeriodCount = Number(projectionOverall.historical_period_count || 0);
  const currentSpendToDate = Number(projectionOverall.current_spend_to_date || 0);
  const scopeLabel = scope === 'household' ? 'household' : 'personal';
  const isQuietPeriod = context === 'quiet_period';

  if (currentSpendToDate <= 0) {
    return [{
      id: `usage_start_logging:${scopeLabel}:${projection?.month || 'current'}`,
      type: 'usage_start_logging',
      title: scope === 'household' ? 'Start logging shared spending' : 'Start logging spending',
      body: scope === 'household'
        ? 'Add a few shared expenses and Adlo will start turning that activity into household guidance.'
        : 'Log a few purchases and Adlo will start turning that activity into more personalized guidance.',
      severity: 'low',
      entity_type: 'budget_period',
      entity_id: `${scopeLabel}:${projection?.month || 'current'}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection?.month || null,
        usage_fallback: true,
        usage_context: context,
      },
      actions: [],
    }];
  }

  if (!(Number(budgetLimit) > 0)) {
    return [{
      id: `usage_set_budget:${scopeLabel}:${projection?.month || 'current'}`,
      type: 'usage_set_budget',
      title: isQuietPeriod
        ? (scope === 'household' ? 'Quiet month, good time to set a shared budget' : 'Quiet month, good time to set your budget')
        : (scope === 'household' ? 'Set a shared budget to sharpen guidance' : 'Set a budget to sharpen guidance'),
      body: isQuietPeriod
        ? (scope === 'household'
          ? 'Shared spending looks relatively quiet right now, which makes this a clean time to set a household budget before activity picks up.'
          : 'Spending looks relatively quiet right now, which makes this a clean time to set a budget before the month gets busier.')
        : (scope === 'household'
          ? 'A shared budget helps Adlo tell whether your household still has room or is already getting tight.'
          : 'A monthly budget gives Adlo a clearer line for when your spending still has room and when it is getting tight.'),
      severity: 'low',
      entity_type: 'budget',
      entity_id: `${scopeLabel}:total`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection?.month || null,
        usage_fallback: true,
        usage_context: context,
      },
      actions: [],
    }];
  }

  if (historicalPeriodCount < 3) {
    return [{
      id: `usage_building_history:${scopeLabel}:${projection?.month || 'current'}`,
      type: 'usage_building_history',
      title: isQuietPeriod
        ? (scope === 'household' ? 'Quiet month, keep building the household baseline' : 'Quiet month, keep building your baseline')
        : (scope === 'household' ? 'Your household is still building a baseline' : 'You are still building a baseline'),
      body: isQuietPeriod
        ? (scope === 'household'
          ? `This month looks relatively calm, but Adlo still only has ${historicalPeriodCount} completed shared ${historicalPeriodCount === 1 ? 'period' : 'periods'} to learn from. Keep logging and the guidance will get sharper.`
          : `This month looks relatively calm, but Adlo still only has ${historicalPeriodCount} completed ${historicalPeriodCount === 1 ? 'period' : 'periods'} to learn from. Keep logging and the guidance will get sharper.`)
        : (scope === 'household'
          ? `Adlo has ${historicalPeriodCount} completed ${historicalPeriodCount === 1 ? 'period' : 'periods'} of shared history so far. Keep logging and the guidance will get sharper.`
          : `Adlo has ${historicalPeriodCount} completed ${historicalPeriodCount === 1 ? 'period' : 'periods'} of history so far. Keep logging and the guidance will get sharper.`),
      severity: 'low',
      entity_type: 'budget_period',
      entity_id: `${scopeLabel}:${projection?.month || 'current'}`,
      created_at: createdAt,
      expires_at: expiresAt,
      metadata: {
        scope: scopeLabel,
        month: projection?.month || null,
        historical_period_count: historicalPeriodCount,
        usage_fallback: true,
        usage_context: context,
      },
      actions: [],
    }];
  }

  return [{
    id: `usage_ready_to_plan:${scopeLabel}:${projection?.month || 'current'}`,
    type: 'usage_ready_to_plan',
    title: isQuietPeriod
      ? 'Quiet month, good time to plan ahead'
      : 'You have enough history to start planning ahead',
    body: isQuietPeriod
      ? (scope === 'household'
        ? 'Shared spending looks relatively calm right now, and you have enough history for Adlo to pressure-test household purchases with more confidence.'
        : 'Spending looks relatively calm right now, and you have enough history for Adlo to pressure-test purchases with more confidence.')
      : (scope === 'household'
        ? 'You have enough shared history for Adlo to start pressure-testing household purchases with more confidence.'
        : 'You have enough history for Adlo to start pressure-testing purchases with more confidence.'),
    severity: 'low',
    entity_type: 'budget_period',
    entity_id: `${scopeLabel}:${projection?.month || 'current'}`,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: {
      scope: scopeLabel,
      month: projection?.month || null,
      historical_period_count: historicalPeriodCount,
      usage_fallback: true,
      usage_context: context,
    },
    actions: [],
  }];
}

function shouldSupplementWithUsageFallback(insights = []) {
  if (!insights.length) return true;

  const nonUsageInsights = insights.filter((insight) => !insight?.metadata?.usage_fallback);
  if (!nonUsageInsights.length) return false;

  const hasMediumOrHighSignal = nonUsageInsights.some((insight) => severityRank(insight.severity) >= 2);
  if (hasMediumOrHighSignal) return false;

  const hasDirectNextStep = nonUsageInsights.some((insight) => {
    const role = portfolioRole(insight);
    return role === 'act' || role === 'plan' || role === 'setup';
  });
  if (hasDirectNextStep) return false;

  return nonUsageInsights.every((insight) => {
    const role = portfolioRole(insight);
    return role === 'explain' || role === 'other';
  });
}

function determineUsageFallbackScope(insights = [], user = null) {
  if (!user?.household_id) return 'personal';

  const scopedInsights = insights.filter((insight) => insight?.metadata?.scope === 'personal' || insight?.metadata?.scope === 'household');
  if (!scopedInsights.length) return 'personal';

  let householdCount = 0;
  let personalCount = 0;

  for (const insight of scopedInsights) {
    if (insight.metadata?.scope === 'household') householdCount += 1;
    if (insight.metadata?.scope === 'personal') personalCount += 1;
  }

  if (householdCount > personalCount) return 'household';
  if (personalCount > householdCount) return 'personal';

  const firstScoped = scopedInsights[0]?.metadata?.scope;
  return firstScoped === 'household' ? 'household' : 'personal';
}

async function buildInsights({ user, limit = 10 }) {
  const insightSets = [];
  let recurringSignals = [];
  let householdWatchCandidates = [];
  const householdMembers = user?.household_id ? await Household.findMembers(user.household_id) : [];
  const hasMultipleHouseholdMembers = householdMembers.length > 1;

  if (user?.household_id) {
    recurringSignals = await detectRecurringItemSignals(user.household_id);
    insightSets.push(recurringSignals.map(toInsight));
    const watchCandidates = await detectRecurringWatchCandidates(user.household_id);
    householdWatchCandidates = watchCandidates;
    insightSets.push(
      watchCandidates
        .filter((candidate) => candidate.status === 'watching' || candidate.status === 'due_today' || candidate.status === 'overdue')
        .slice(0, 3)
        .map(toRepurchaseDueInsight)
    );

    const watchOpportunities = await findObservationOpportunities(user.household_id);
    insightSets.push(
      watchOpportunities
        .slice(0, 3)
        .map(toBuySoonBetterPriceInsight)
    );

    const spikeSignals = recurringSignals.filter((signal) => signal.signal === 'price_spike');
    const totalRecurringDelta = spikeSignals.reduce((sum, signal) => sum + Math.max(Number(signal.delta_amount || 0), 0), 0);
    const maxRecurringDeltaPercent = spikeSignals.reduce(
      (max, signal) => Math.max(max, Math.abs(Number(signal.delta_percent || 0))),
      0
    );
    if (spikeSignals.length >= 2 || totalRecurringDelta >= 2 || maxRecurringDeltaPercent >= 15) {
      const topItems = spikeSignals
        .slice()
        .sort((a, b) => Math.abs(Number(b.delta_amount || 0)) - Math.abs(Number(a.delta_amount || 0)))
        .slice(0, 2)
        .map((signal) => signal.item_name);
      const topSpikeSignals = spikeSignals
        .slice()
        .sort((a, b) => Math.abs(Number(b.delta_amount || 0)) - Math.abs(Number(a.delta_amount || 0)))
        .slice(0, 4)
        .map((signal) => ({
          group_key: signal.group_key,
          item_name: signal.item_name,
          latest_merchant: signal.latest_merchant,
          latest_date: signal.latest_date,
          comparison_type: signal.comparison_type,
          latest_value: Number(signal.latest_value || 0),
          baseline_value: Number(signal.baseline_value || 0),
          delta_amount: Number(signal.delta_amount || 0),
          delta_percent: Number(signal.delta_percent || 0),
        }));
      insightSets.push([{
        id: `recurring_cost_pressure:${user.household_id}:${spikeSignals.map((signal) => signal.group_key).join('|')}`,
        type: 'recurring_cost_pressure',
        title: 'Recurring purchases are getting more expensive',
        body: topItems.length
          ? `${topItems.join(' and ')} are above their usual price, adding about $${Number(totalRecurringDelta.toFixed(2))} of extra spend versus your recent baseline.`
          : `Several recurring purchases are above their usual price, adding about $${Number(totalRecurringDelta.toFixed(2))} of extra spend versus your recent baseline.`,
        severity: totalRecurringDelta >= 10 || spikeSignals.length >= 3 ? 'high' : 'medium',
        entity_type: 'household',
        entity_id: user.household_id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          scope: 'household',
          spike_count: spikeSignals.length,
          total_delta_amount: Number(totalRecurringDelta.toFixed(2)),
          items: topItems,
          recurring_spike_signals: topSpikeSignals,
        },
        actions: [],
      }]);
    }
  }

  if (user?.id) {
    const personalTrend = await analyzeSpendingTrend({ user, scope: 'personal' });
    insightSets.push(buildTrendInsights(personalTrend, 'personal'));
    const personalProjection = await analyzeSpendProjection({ user, scope: 'personal' });
    const personalBudgetSettings = await BudgetSetting.findByUser(user.id);
    const personalBudgetLimit = personalBudgetSettings.find((row) => row.category_id == null)?.monthly_limit ?? null;
    const personalRollingActivity = await analyzeRollingActivity({ user, scope: 'personal' });
    insightSets.push(buildEarlyUsageInsights({
      projection: personalProjection,
      budgetLimit: personalBudgetLimit,
      scope: 'personal',
    }));
    insightSets.push(buildDevelopingUsageInsights({
      rollingActivity: personalRollingActivity,
      projection: personalProjection,
      scope: 'personal',
    }));
    insightSets.push(buildProjectionInsights(personalProjection, 'personal'));
  }

  if (user?.household_id && hasMultipleHouseholdMembers) {
    const householdTrend = await analyzeSpendingTrend({ user, scope: 'household' });
    insightSets.push(buildTrendInsights(householdTrend, 'household'));
    const householdProjection = await analyzeSpendProjection({ user, scope: 'household' });
    const householdBudgetSettings = await BudgetSetting.findByHousehold(user.household_id);
    const householdBudgetLimit = householdBudgetSettings.find((row) => row.category_id == null)?.monthly_limit ?? null;
    const householdRollingActivity = await analyzeRollingActivity({ user, scope: 'household' });
    insightSets.push(buildEarlyUsageInsights({
      projection: householdProjection,
      budgetLimit: householdBudgetLimit,
      scope: 'household',
    }));
    insightSets.push(buildDevelopingUsageInsights({
      rollingActivity: householdRollingActivity,
      projection: householdProjection,
      scope: 'household',
    }));
    insightSets.push(buildProjectionInsights(householdProjection, 'household'));
    insightSets.push(buildRestockWindowInsights({ projection: householdProjection, watchCandidates: householdWatchCandidates }));
  }

  let deduped = dedupeInsights(
    insightSets
      .flat()
      .filter(Boolean)
      .filter((insight) => !!insight?.id)
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || new Date(b.created_at) - new Date(a.created_at))
  );

  if (deduped.length === 0 && user?.id) {
    const personalProjection = await analyzeSpendProjection({ user, scope: 'personal' });
    const personalBudgetSettings = await BudgetSetting.findByUser(user.id);
    const personalBudgetLimit = personalBudgetSettings.find((row) => row.category_id == null)?.monthly_limit ?? null;
    deduped = buildUsageFallbackInsights({
      user,
      projection: personalProjection,
      budgetLimit: personalBudgetLimit,
      scope: 'personal',
    });
  }

  return resolveMaturityCompetition(resolveOpportunityCompetition(deduped))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

async function buildInsightsForUser({ user, limit = 10 }) {
  const rawInsights = await buildInsights({ user, limit: Math.max(limit * 2, limit) });
  if (!user?.id || !rawInsights.length) return rawInsights.slice(0, limit);

  const [stateMap, recentEvents] = await Promise.all([
    InsightState.getStateMap(user.id, rawInsights.map((insight) => insight.id)),
    InsightEvent.getRecentByUser(user.id, 500),
  ]);
  const inferredEvents = await inferOutcomeEventsForUser({ user, events: recentEvents });
  const feedbackSummary = summarizeFeedbackEvents([...recentEvents, ...inferredEvents]);

  const ranked = rawInsights
    .map((insight) => {
      const state = stateMap.get(insight.id);
      return state ? {
        ...insight,
        state: {
          status: state.status,
          updated_at: state.updated_at,
        },
      } : insight;
    })
    .filter((insight) => insight.state?.status !== 'dismissed')
    .filter((insight) => !shouldSuppressInsight(insight, feedbackSummary))
    .sort((a, b) => {
      const scoreDiff = insightRankScore(b, feedbackSummary) - insightRankScore(a, feedbackSummary);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  let supplementedRanked = ranked;
  if (shouldSupplementWithUsageFallback(ranked)) {
    const fallbackScope = determineUsageFallbackScope(ranked, user);
    const [fallbackProjection, fallbackBudgetSettings] = await Promise.all([
      analyzeSpendProjection({ user, scope: fallbackScope }),
      fallbackScope === 'household' && user.household_id
        ? BudgetSetting.findByHousehold(user.household_id)
        : BudgetSetting.findByUser(user.id),
    ]);
    const fallbackBudgetLimit = fallbackBudgetSettings.find((row) => row.category_id == null)?.monthly_limit ?? null;
    const fallbackInsights = buildUsageFallbackInsights({
      user,
      projection: fallbackProjection,
      budgetLimit: fallbackBudgetLimit,
      scope: fallbackScope,
      context: 'quiet_period',
    });

    supplementedRanked = resolveMaturityCompetition(dedupeInsights([...ranked, ...fallbackInsights])).sort((a, b) => {
      const scoreDiff = insightRankScore(b, feedbackSummary) - insightRankScore(a, feedbackSummary);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  return orchestrateInsightPortfolio(supplementedRanked, feedbackSummary, limit);
}

module.exports = {
  buildInsights,
  buildInsightsForUser,
  buildEarlyUsageInsights,
  buildDevelopingUsageInsights,
  summarizeExpenseRows,
  insightContinuityKey,
  resolveMaturityCompetition,
  buildUsageFallbackInsights,
  shouldSupplementWithUsageFallback,
  determineUsageFallbackScope,
  insightRankScore,
  insightDestinationAdjustment,
  portfolioRole,
  portfolioFamily,
  narrativeClusterKey,
  narrativeTheme,
  orchestrateInsightPortfolio,
};
