const { detectRecurringItemSignals, detectRecurringWatchCandidates } = require('./recurringDetector');
const { listItemHistorySummaries } = require('./itemHistoryService');
const { analyzeSpendingTrend } = require('./spendingTrendAnalyzer');
const { analyzeSpendProjection } = require('./spendProjectionAnalyzer');
const { findObservationOpportunities } = require('./priceObservationService');
const BudgetSetting = require('../models/budgetSetting');
const { inferOutcomeEventsForUser, summarizeOutcomeWindows } = require('./insightOutcomeInference');
const InsightState = require('../models/insightState');
const InsightEvent = require('../models/insightEvent');
const Household = require('../models/household');
const { loadTimingPreferences, strongTimingPreferenceStats, insightTimingPreferenceNote } = require('./planningProfileService');
const { summarizeFeedbackEvents, shouldSuppressInsight } = require('./insightFeedbackSummary');
const { buildInsightPreferenceSummary } = require('./insightPreferenceSummary');
const {
  USAGE_INSIGHT_THRESHOLDS,
  buildEarlyUsageInsights,
  summarizeExpenseRows,
  analyzeRollingActivity,
  buildDevelopingUsageInsights,
  tierGateSummary,
} = require('./usageInsightSignals');
const {
  severityRank,
  insightDestinationAdjustment,
  annotateInsightScopeLineage,
  insightContinuityKey,
  scopeAgnosticContinuityKey,
  resolveMaturityCompetition,
  resolveScopeOverlapCompetition,
  resolveInsightCompetition,
} = require('./insightPortfolio');
const {
  scoreInsightCandidate,
  insightSurfaceDecision,
  summarizeSurfaceDecisions,
  compareRankingStrategies,
  insightRankScore,
  scopeHierarchyAdjustment,
  promoteExplorationCandidate,
  portfolioRole,
  portfolioFamily,
  narrativeClusterKey,
  narrativeTheme,
  orchestrateInsightPortfolio,
} = require('./insightSelectionService');

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
      return `${itemName} jumped in price`;
    case 'better_than_usual':
      return `${itemName} came in below your usual price`;
    case 'cheaper_elsewhere':
      return `${itemName} is cheaper at another merchant`;
    default:
      return itemName;
  }
}

function bodyForSignal(signal, insight) {
  const pct = Math.abs(Number(insight.delta_percent || 0));
  switch (signal) {
    case 'price_spike':
      return `${insight.latest_merchant} came in ${pct}% above your usual ${insight.comparison_type === 'unit_price' ? 'unit price' : 'price'} for this item.`;
    case 'better_than_usual':
      return `${insight.latest_merchant} came in ${pct}% below your usual ${insight.comparison_type === 'unit_price' ? 'unit price' : 'price'} for this item.`;
    case 'cheaper_elsewhere':
      return `${insight.cheaper_merchant} has recently been about ${pct}% cheaper than ${insight.latest_merchant} for this item.`;
    default:
      return '';
  }
}

function toInsight(signal, scope = 'household') {
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
    metadata: {
      ...signal,
      scope,
      continuity_key: `recurring_signal:${scope}:${signal.group_key}:${signal.signal}`,
    },
    actions: [],
  };
}

function toRepurchaseDueInsight(candidate, scope = 'household') {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const itemName = candidate.item_name || 'A recurring purchase';
  let title = `${itemName} may be due soon`;
  let body = `You usually buy this about every ${candidate.average_gap_days} days, and you may need it again in ${candidate.days_until_due} days.`;

  if (candidate.status === 'due_today') {
    title = `${itemName} may be due today`;
    body = `Today lines up with your usual ${candidate.average_gap_days}-day repurchase timing for this item.`;
  } else if (candidate.status === 'overdue') {
    title = `${itemName} may already be due`;
    body = `You are about ${Math.abs(candidate.days_until_due)} days past your usual repurchase window for this item.`;
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
      scope,
      continuity_key: `recurring_due:${scope}:${candidate.group_key}`,
    },
    actions: [],
  };
}

function toBuySoonBetterPriceInsight(opportunity, scope = 'household') {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const itemName = opportunity.item_name || 'A recurring item';
  const title = `${itemName} looks cheaper right now`;
  const body = `${opportunity.merchant} is ${opportunity.discount_percent}% below your usual ${opportunity.comparison_type === 'unit_price' ? 'unit price' : 'price'}, and you may need this in ${Math.max(opportunity.days_until_due, 0)} days.`;

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
      scope,
      continuity_key: `recurring_buy_opportunity:${scope}:${opportunity.group_key}`,
    },
    actions: [],
  };
}

function buildItemHistoryInsights(histories = [], scope = 'household') {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const insights = [];

  for (const history of histories) {
    const itemName = history.item_name || 'This item';
    const merchantBreakdown = Array.isArray(history.merchant_breakdown) ? history.merchant_breakdown : [];
    const stapleEmerging = (
      Number(history.occurrence_count || 0) >= 3
      && Number(history.average_gap_days || 0) > 0
      && Number(history.average_gap_days || 0) <= 21
      && Number(history.median_amount || 0) >= 8
    );

    const sortedMerchants = merchantBreakdown
      .filter((entry) => Number(entry.occurrence_count || 0) >= 1)
      .sort((a, b) => {
        const aValue = a.median_unit_price ?? a.median_amount ?? Number.MAX_SAFE_INTEGER;
        const bValue = b.median_unit_price ?? b.median_amount ?? Number.MAX_SAFE_INTEGER;
        return aValue - bValue;
      });

    let merchantVariance = null;
    if (sortedMerchants.length >= 2) {
      const cheapest = sortedMerchants[0];
      const priciest = sortedMerchants[sortedMerchants.length - 1];
      const cheapestValue = Number(cheapest.median_unit_price ?? cheapest.median_amount ?? 0);
      const priciestValue = Number(priciest.median_unit_price ?? priciest.median_amount ?? 0);
      const deltaAmount = Number((priciestValue - cheapestValue).toFixed(2));
      const deltaPercent = cheapestValue > 0
        ? Number((((priciestValue - cheapestValue) / cheapestValue) * 100).toFixed(1))
        : 0;

      if (deltaAmount >= 1.5 && deltaPercent >= 10) {
        merchantVariance = {
          cheapest,
          priciest,
          cheapestValue,
          priciestValue,
          deltaAmount,
          deltaPercent,
        };
      }
    }

    if (stapleEmerging && merchantVariance) {
      insights.push({
        id: `item_staple_merchant_opportunity:${scope}:${history.group_key}:${merchantVariance.cheapest.merchant}:${merchantVariance.priciest.merchant}`,
        type: 'item_staple_merchant_opportunity',
        title: `${itemName} is becoming a regular buy`,
        body: `${itemName} has shown up ${history.occurrence_count} times recently, and ${merchantVariance.cheapest.merchant} has been about ${merchantVariance.deltaPercent}% cheaper than ${merchantVariance.priciest.merchant}.`,
        severity: merchantVariance.deltaPercent >= 20 || merchantVariance.deltaAmount >= 4 || Number(history.occurrence_count || 0) >= 4 ? 'medium' : 'low',
        entity_type: 'item',
        entity_id: history.group_key,
        created_at: createdAt,
        expires_at: expiresAt,
        metadata: {
          ...history,
          scope,
          maturity: 'developing',
          confidence: history.identity_confidence || 'medium',
          comparison_type: merchantVariance.cheapest.median_unit_price != null && merchantVariance.priciest.median_unit_price != null ? 'unit_price' : 'price',
          cheaper_merchant: merchantVariance.cheapest.merchant,
          pricier_merchant: merchantVariance.priciest.merchant,
          cheaper_value: merchantVariance.cheapestValue,
          pricier_value: merchantVariance.priciestValue,
          delta_amount: merchantVariance.deltaAmount,
          delta_percent: merchantVariance.deltaPercent,
          continuity_key: `item_story:${scope}:${history.group_key}`,
        },
        actions: [],
      });
      continue;
    }

    if (stapleEmerging) {
      insights.push({
        id: `item_staple_emerging:${scope}:${history.group_key}:${history.last_purchased_at}`,
        type: 'item_staple_emerging',
        title: `${itemName} is becoming a regular buy`,
        body: history.merchants?.length > 1
          ? `You have bought ${itemName} ${history.occurrence_count} times recently, about every ${history.average_gap_days} days, across ${history.merchants.length} merchants.`
          : `You have bought ${itemName} ${history.occurrence_count} times recently, about every ${history.average_gap_days} days.`,
        severity: Number(history.occurrence_count || 0) >= 4 ? 'medium' : 'low',
        entity_type: 'item',
        entity_id: history.group_key,
        created_at: createdAt,
        expires_at: expiresAt,
        metadata: {
          ...history,
          scope,
          maturity: 'developing',
          confidence: history.identity_confidence || 'medium',
          continuity_key: `item_pattern:${scope}:${history.group_key}`,
        },
        actions: [],
      });
    }

    if (merchantVariance) {
        insights.push({
          id: `item_merchant_variance:${scope}:${history.group_key}:${merchantVariance.cheapest.merchant}:${merchantVariance.priciest.merchant}`,
          type: 'item_merchant_variance',
          title: `${itemName} tends to cost less at ${merchantVariance.cheapest.merchant}`,
          body: `${history.item_name || 'This item'} has recently run about ${merchantVariance.deltaPercent}% lower at ${merchantVariance.cheapest.merchant} than at ${merchantVariance.priciest.merchant}.`,
          severity: merchantVariance.deltaPercent >= 20 || merchantVariance.deltaAmount >= 4 ? 'medium' : 'low',
          entity_type: 'item',
          entity_id: history.group_key,
          created_at: createdAt,
          expires_at: expiresAt,
          metadata: {
            ...history,
            scope,
            maturity: 'developing',
            confidence: history.identity_confidence || 'medium',
            comparison_type: merchantVariance.cheapest.median_unit_price != null && merchantVariance.priciest.median_unit_price != null ? 'unit_price' : 'price',
            cheaper_merchant: merchantVariance.cheapest.merchant,
            pricier_merchant: merchantVariance.priciest.merchant,
            cheaper_value: merchantVariance.cheapestValue,
            pricier_value: merchantVariance.priciestValue,
            delta_amount: merchantVariance.deltaAmount,
            delta_percent: merchantVariance.deltaPercent,
            continuity_key: `item_merchant:${scope}:${history.group_key}`,
          },
          actions: [],
        });
    }
  }

  return insights;
}

async function loadItemHistoryInsightsBestEffort(ownerId, {
  scope = 'household',
  minOccurrences = 3,
  limit = 8,
} = {}) {
  if (!ownerId) return [];
  try {
    const histories = await listItemHistorySummaries(ownerId, {
      scope,
      minOccurrences,
      limit,
    });
    return buildItemHistoryInsights(histories, scope);
  } catch (err) {
    console.error('[insightBuilder] item history insights skipped:', {
      owner_id: ownerId,
      scope,
      message: err?.message || String(err || 'unknown_error'),
      code: err?.code || null,
    });
    return [];
  }
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

function buildRestockWindowInsights({ projection, watchCandidates = [], scope = 'household' }) {
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
  const scopeLabel = scope === 'household' ? 'household' : 'personal';

  insights.push({
    id: `recurring_restock_window:${scopeLabel}:${candidate.group_key}:${projection.month}`,
    type: 'recurring_restock_window',
    title: `${itemName} could fit this period`,
    body: scope === 'household'
      ? `You are projected to finish about $${projectedHeadroomAmount.toFixed(0)} under budget, and ${itemName} may be due in ${Math.max(Number(candidate.days_until_due || 0), 0)} days.`
      : `You are projected to finish about $${projectedHeadroomAmount.toFixed(0)} under budget personally, and ${itemName} may be due in ${Math.max(Number(candidate.days_until_due || 0), 0)} days.`,
    severity: projectedHeadroomAmount >= Number(candidate.median_amount || 0) * 2 ? 'medium' : 'low',
    entity_type: 'item',
    entity_id: candidate.group_key,
    created_at: createdAt,
    expires_at: expiresAt,
    metadata: {
      ...candidate,
      scope,
      month: projection.month,
      projected_headroom_amount: projectedHeadroomAmount,
      projected_budget_delta: projectedBudgetDelta,
      projection_confidence: overall.confidence,
      continuity_key: `recurring_restock:${scope}:${candidate.group_key}`,
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
      title: deltaPercent >= 0 ? 'You are ahead of your usual pace' : 'You are below your usual pace',
      body: deltaPercent >= 0
        ? `You are ${Math.abs(deltaPercent)}% ahead of your usual ${scopeLabel} pace for this point in the period, so this month is tightening faster than normal.`
        : `You are ${Math.abs(deltaPercent)}% below your usual ${scopeLabel} pace for this point in the period, which is leaving more room than normal so far.`,
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
      title: `${topDriver.category_name} is the clearest driver right now`,
      body: Number(topDriver.delta_amount) >= 0
        ? `${topDriver.category_name} is already running about $${Math.abs(Number(topDriver.delta_amount)).toFixed(0)} above its usual ${scopeLabel} pace, making it the biggest contributor to the shift this period.`
        : `${topDriver.category_name} is running about $${Math.abs(Number(topDriver.delta_amount)).toFixed(0)} below its usual ${scopeLabel} pace, which is creating some of the extra room this period.`,
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
        category_trust_score: Number(topDriver?.category_provenance?.trust_score ?? 0),
        category_trusted_count: Number(topDriver?.category_provenance?.trusted_count || 0),
        category_low_confidence_count: Number(topDriver?.category_provenance?.low_confidence_count || 0),
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
      title: 'A few unusual purchases are doing most of the damage',
      body: merchantNames.length
        ? `${merchantNames.join(' and ')} are accounting for most of the extra ${scopeLabel} spend versus your usual pace so far this period, so the pressure is less broad-based than it first looks.`
        : `A few unusual purchases are accounting for most of the extra ${scopeLabel} spend versus your usual pace so far this period, so the pressure is less broad-based than it first looks.`,
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
        continuity_key: `one_off_variance:${scopeLabel}:${trend.month}`,
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
        ? `Your ${scopeLabel} budget is probably set too tight`
        : `Your ${scopeLabel} budget may be looser than you need`,
      body: budgetFit === 'too_low'
        ? `You have gone over this ${scopeLabel} budget in ${trend.budget_adherence.over_budget_periods_last_6} of the last ${budgetHistoryCount} periods, which suggests the target itself may need to move.`
        : `You have stayed well under this ${scopeLabel} budget in ${trend.budget_adherence.under_budget_periods_last_6} of the last ${budgetHistoryCount} periods, so this target may be higher than it needs to be.`,
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
        continuity_key: `budget_fit:${scopeLabel}:total`,
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
      title: `You are on track to finish over budget`,
      body: `At the current pace, your ${scopeLabel} spending is on track to finish about $${Math.abs(projectedBudgetDelta).toFixed(0)} above budget by month end.`,
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
      title: `You still have room left this period`,
      body: `At the current pace, your ${scopeLabel} spending is on track to finish about $${Math.abs(projectedBudgetDelta).toFixed(0)} under budget by month end.`,
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
      title: 'One unusual purchase is distorting the forecast',
      body: `${topExpense.merchant} is contributing a meaningful share of this month’s projected overage, so your baseline spend is more normal than the all-in forecast suggests.`,
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
        continuity_key: `projection_one_off:${scopeLabel}:${projection.month}`,
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
      title: `${topCategoryProjection.category_name} is likely to finish high`,
      body: `${topCategoryProjection.category_name} is on track to finish about $${Math.abs(Number(topCategoryProjection.delta_amount || 0)).toFixed(0)} above its usual level for this period.`,
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
        category_trust_score: Number(topCategoryProjection?.category_provenance?.trust_score ?? 0),
        category_trusted_count: Number(topCategoryProjection?.category_provenance?.trusted_count || 0),
        category_low_confidence_count: Number(topCategoryProjection?.category_provenance?.low_confidence_count || 0),
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
      title: `${lowestCategoryProjection.category_name} still has room left`,
      body: `${lowestCategoryProjection.category_name} is on track to finish about $${Math.abs(Number(lowestCategoryProjection.delta_amount || 0)).toFixed(0)} below its usual level this period.`,
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
        category_trust_score: Number(lowestCategoryProjection?.category_provenance?.trust_score ?? 0),
        category_trusted_count: Number(lowestCategoryProjection?.category_provenance?.trusted_count || 0),
        category_low_confidence_count: Number(lowestCategoryProjection?.category_provenance?.low_confidence_count || 0),
        maturity: 'mature',
        continuity_key: `category:${scopeLabel}:${lowestCategoryProjection.category_key}`,
      },
      actions: [],
    });
  }

  return insights;
}

function plannerTimingAdjustmentForInsight(insight, timingPreferences = {}) {
  const type = `${insight?.type || ''}`.trim();
  const scope = `${insight?.metadata?.scope || ''}`.trim();
  if (scope !== 'personal') return 0;

  if (type === 'recurring_restock_window') {
    const prefersNow = strongTimingPreferenceStats('now', timingPreferences);
    const prefersNextPeriod = strongTimingPreferenceStats('next_period', timingPreferences);
    const prefersSpread = strongTimingPreferenceStats('spread_3_periods', timingPreferences);
    const daysUntilDue = Number(insight?.metadata?.days_until_due || 0);
    const severity = `${insight?.severity || ''}`.trim();

    if (prefersNow) return 10;
    if ((prefersNextPeriod || prefersSpread) && severity === 'low' && daysUntilDue > 2) return -12;
    if ((prefersNextPeriod || prefersSpread) && daysUntilDue > 0) return -6;
  }

  if (type === 'recurring_repurchase_due') {
    const prefersNow = strongTimingPreferenceStats('now', timingPreferences);
    const prefersNextPeriod = strongTimingPreferenceStats('next_period', timingPreferences);
    const daysUntilDue = Number(insight?.metadata?.days_until_due || 0);
    const severity = `${insight?.severity || ''}`.trim();

    if (prefersNow && daysUntilDue <= 1) return 10;
    if (prefersNextPeriod && severity !== 'high' && daysUntilDue > 1) return -8;
  }

  if (type === 'buy_soon_better_price' || type === 'item_staple_merchant_opportunity') {
    const prefersNow = strongTimingPreferenceStats('now', timingPreferences);
    const prefersNextPeriod = strongTimingPreferenceStats('next_period', timingPreferences);
    const prefersSpread = strongTimingPreferenceStats('spread_3_periods', timingPreferences);
    const daysUntilDue = Number(insight?.metadata?.days_until_due || 0);

    if (prefersNow && daysUntilDue >= 0 && daysUntilDue <= 3) return 8;
    if ((prefersNextPeriod || prefersSpread) && daysUntilDue > 3) return -6;
  }

  return 0;
}

function plannerTimingNoteForInsight(insight, timingPreferences = {}) {
  const type = `${insight?.type || ''}`.trim();
  const scope = `${insight?.metadata?.scope || ''}`.trim();
  if (scope !== 'personal') return null;
  return insightTimingPreferenceNote(type, timingPreferences);
}

function annotateInsightWithPlannerTiming(insight, timingPreferences = {}) {
  if (!insight) return insight;
  const timingAdjustment = plannerTimingAdjustmentForInsight(insight, timingPreferences);
  const timingNote = plannerTimingNoteForInsight(insight, timingPreferences);
  if (!timingAdjustment && !timingNote) return insight;

  const body = timingNote && !`${insight.body || ''}`.includes(timingNote)
    ? `${insight.body} ${timingNote}`.trim()
    : insight.body;

  return {
    ...insight,
    body,
    metadata: {
      ...(insight.metadata || {}),
      planner_timing_adjustment: timingAdjustment,
      planner_timing_note: timingNote,
    },
  };
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

function buildDismissedContinuityKeySet(events = [], windowDays = 30) {
  const safeWindowDays = Math.max(1, Math.min(Number(windowDays) || 30, 180));
  const cutoffMs = Date.now() - safeWindowDays * 24 * 60 * 60 * 1000;
  const keys = new Set();

  for (const event of events || []) {
    if (`${event?.event_type || ''}`.trim() !== 'dismissed') continue;
    const createdAtMs = new Date(event?.created_at || 0).getTime();
    if (Number.isNaN(createdAtMs) || createdAtMs < cutoffMs) continue;
    const continuityKey = `${event?.metadata?.continuity_key || ''}`.trim();
    if (continuityKey) keys.add(continuityKey);
  }

  return keys;
}

function summarizeInsightList(insights = []) {
  const byType = {};
  const byMaturity = {};
  const bySeverity = {};

  for (const insight of insights || []) {
    const type = insight?.type || 'unknown';
    const maturity = insight?.metadata?.maturity || 'unspecified';
    const severity = insight?.severity || 'low';
    byType[type] = (byType[type] || 0) + 1;
    byMaturity[maturity] = (byMaturity[maturity] || 0) + 1;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }

  return {
    count: insights.length,
    by_type: byType,
    by_maturity: byMaturity,
    by_severity: bySeverity,
    ids: insights.map((insight) => insight.id).filter(Boolean),
  };
}

function insightDebugRows(insights = [], feedbackSummary = new Map(), preferenceSummary = {}) {
  return (insights || []).map((insight) => ({
    id: insight.id,
    type: insight.type,
    title: insight.title,
    severity: insight.severity,
    entity_type: insight.entity_type,
    entity_id: insight.entity_id,
    maturity: insight.metadata?.maturity || null,
    confidence: insight.metadata?.confidence || null,
    scope: insight.metadata?.scope || null,
    scope_origin: insight.metadata?.scope_origin || null,
    hierarchy_level: insight.metadata?.hierarchy_level || null,
    rolls_up_from_personal: insight.metadata?.rolls_up_from_personal ?? null,
    household_context_included: insight.metadata?.household_context_included ?? null,
    scope_relationship: insight.metadata?.scope_relationship || null,
    continuity_key: insightContinuityKey(insight),
    state: insight.state?.status || null,
    scoring: insightSurfaceDecision(insight, feedbackSummary, preferenceSummary),
  }));
}

async function buildInsightDebugForUser({ user, limit = 10 }) {
  const householdMembers = user?.household_id ? await Household.findMembers(user.household_id) : [];
  const hasMultipleHouseholdMembers = householdMembers.length > 1;
  const scopes = ['personal'];
  if (user?.household_id && hasMultipleHouseholdMembers) scopes.push('household');

  const scopeReports = [];
  for (const scope of scopes) {
    const [trend, projection, budgetSettings, rollingActivity] = await Promise.all([
      analyzeSpendingTrend({ user, scope }),
      analyzeSpendProjection({ user, scope }),
      scope === 'household' && user.household_id
        ? BudgetSetting.findByHousehold(user.household_id)
        : BudgetSetting.findByUser(user.id),
      analyzeRollingActivity({ user, scope }),
    ]);
    const budgetLimit = budgetSettings.find((row) => row.category_id == null)?.monthly_limit ?? null;
    const early = buildEarlyUsageInsights({ projection, budgetLimit, scope });
    const developing = buildDevelopingUsageInsights({ rollingActivity, projection, scope });
    const mature = [
      ...buildTrendInsights(trend, scope),
      ...buildProjectionInsights(projection, scope),
    ];
    const merged = resolveInsightCompetition(dedupeInsights([...early, ...developing, ...mature]));

    scopeReports.push({
      scope,
      gates: tierGateSummary({ projection, rollingActivity, budgetLimit }),
      tiers: {
        early: summarizeInsightList(early),
        developing: summarizeInsightList(developing),
        mature: summarizeInsightList(mature),
        after_maturity_competition: summarizeInsightList(merged),
      },
      generated: {
        early: insightDebugRows(early),
        developing: insightDebugRows(developing),
        mature: insightDebugRows(mature),
        after_maturity_competition: insightDebugRows(merged),
      },
    });
  }

  const [rawInsights, finalInsights, recentEvents] = await Promise.all([
    buildInsights({ user, limit: 50 }),
    buildInsightsForUser({ user, limit }),
    InsightEvent.getRecentByUser(user.id, 500),
  ]);
  const stateMap = await InsightState.getStateMap(user.id, rawInsights.map((insight) => insight.id));
  const inferredEvents = await inferOutcomeEventsForUser({ user, events: recentEvents });
  const allEvents = [...recentEvents, ...inferredEvents];
  const feedbackSummary = summarizeFeedbackEvents(allEvents);
  const outcomeWindows = summarizeOutcomeWindows(allEvents);
  const preferenceSummary = buildInsightPreferenceSummary(allEvents, { outcomeWindows });
  const surfaceDecisions = rawInsights.map((insight) => ({
    id: insight.id,
    type: insight.type,
    title: insight.title,
    insight,
    scoring: insightSurfaceDecision(insight, feedbackSummary, preferenceSummary),
  }));

  return {
    user_id: user.id,
    limit,
    scopes: scopeReports,
    raw: summarizeInsightList(rawInsights),
    final: summarizeInsightList(finalInsights),
    final_insights: insightDebugRows(finalInsights, feedbackSummary, preferenceSummary),
    feedback: {
      event_count: recentEvents.length + inferredEvents.length,
      inferred_event_count: inferredEvents.length,
      suppressed_raw_count: rawInsights.filter((insight) => shouldSuppressInsight(insight, feedbackSummary)).length,
      below_threshold_raw_count: surfaceDecisions.filter((entry) => !entry.scoring?.eligible).length,
      dismissed_raw_count: rawInsights.filter((insight) => stateMap.get(insight.id)?.status === 'dismissed').length,
      pending_outcome_window_count: outcomeWindows.filter((window) => window.status === 'pending').length,
      expired_outcome_window_count: outcomeWindows.filter((window) => window.status === 'expired_no_action').length,
    },
    preferences: preferenceSummary,
    outcome_windows: outcomeWindows.slice(0, 20),
    surface_summary: summarizeSurfaceDecisions(surfaceDecisions),
    ranking_comparison: compareRankingStrategies(rawInsights, feedbackSummary, preferenceSummary, limit),
    surface_decisions: surfaceDecisions,
  };
}

async function buildInsightPreferencesForUser({ user, limit = 500 }) {
  if (!user?.id) return null;
  const recentEvents = await InsightEvent.getRecentByUser(
    user.id,
    Math.max(25, Math.min(Number(limit) || 500, 1000))
  );
  const inferredEvents = await inferOutcomeEventsForUser({ user, events: recentEvents });
  const allEvents = [...recentEvents, ...inferredEvents];
  const outcomeWindows = summarizeOutcomeWindows(allEvents);
  const preferenceSummary = buildInsightPreferenceSummary(allEvents, { outcomeWindows });

  return {
    user_id: user.id,
    event_count: allEvents.length,
    direct_event_count: recentEvents.length,
    inferred_event_count: inferredEvents.length,
    preferences: preferenceSummary,
    outcome_windows: {
      pending: outcomeWindows.filter((window) => window.status === 'pending').length,
      expired_no_action: outcomeWindows.filter((window) => window.status === 'expired_no_action').length,
      resolved: outcomeWindows.filter((window) => window.status === 'resolved').length,
      recent: outcomeWindows.slice(0, 20),
    },
  };
}

function buildUsageFallbackInsights({ user, projection, budgetLimit = null, scope = 'personal', context = 'default' }) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const projectionOverall = projection?.overall || {};
  const historicalPeriodCount = Number(projectionOverall.historical_period_count || 0);
  const currentSpendToDate = Number(projectionOverall.current_spend_to_date || 0);
  const scopeLabel = scope === 'household' ? 'household' : 'personal';
  const isQuietPeriod = context === 'quiet_period';
  const withLineage = (insights) => insights.map(annotateInsightScopeLineage);

  if (currentSpendToDate <= 0) {
    return withLineage([{
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
        continuity_key: `usage_start_logging:${scopeLabel}:${projection?.month || 'current'}`,
      },
      actions: [],
    }]);
  }

  if (!(Number(budgetLimit) > 0)) {
    return withLineage([{
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
        continuity_key: `usage_set_budget:${scopeLabel}:${projection?.month || 'current'}`,
      },
      actions: [],
    }]);
  }

  if (historicalPeriodCount < 3) {
    return withLineage([{
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
        continuity_key: `usage_building_history:${scopeLabel}:${projection?.month || 'current'}`,
      },
      actions: [],
    }]);
  }

  return withLineage([{
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
      continuity_key: `usage_ready_to_plan:${scopeLabel}:${projection?.month || 'current'}`,
    },
    actions: [],
  }]);
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

  if (personalCount > 0) return 'personal';
  if (householdCount > 0) return 'household';

  return 'personal';
}

async function buildInsights({ user, limit = 10 }) {
  const insightSets = [];
  let recurringSignals = [];
  let householdWatchCandidates = [];
  const householdMembers = user?.household_id ? await Household.findMembers(user.household_id) : [];
  const hasMultipleHouseholdMembers = householdMembers.length > 1;
  const timingPreferences = await loadTimingPreferences(user?.id);

  if (user?.household_id) {
    insightSets.push(await loadItemHistoryInsightsBestEffort(user.household_id, {
      scope: 'household',
      minOccurrences: 3,
      limit: 8,
    }));

    recurringSignals = await detectRecurringItemSignals(user.household_id);
    insightSets.push(recurringSignals.map((signal) => toInsight(signal, 'household')));
    const watchCandidates = await detectRecurringWatchCandidates(user.household_id);
    householdWatchCandidates = watchCandidates;
    insightSets.push(
      watchCandidates
        .filter((candidate) => candidate.status === 'watching' || candidate.status === 'due_today' || candidate.status === 'overdue')
        .slice(0, 3)
        .map((candidate) => toRepurchaseDueInsight(candidate, 'household'))
    );

    const watchOpportunities = await findObservationOpportunities(user.household_id);
    insightSets.push(
      watchOpportunities
        .slice(0, 3)
        .map((opportunity) => toBuySoonBetterPriceInsight(opportunity, 'household'))
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
          continuity_key: `recurring_cost_pressure:household:${user.household_id}`,
        },
        actions: [],
      }]);
    }
  }

  if (user?.id) {
    insightSets.push(await loadItemHistoryInsightsBestEffort(user.id, {
      scope: 'personal',
      minOccurrences: 3,
      limit: 8,
    }));

    const personalRecurringSignals = await detectRecurringItemSignals(user.id, { scope: 'personal' });
    insightSets.push(personalRecurringSignals.map((signal) => toInsight(signal, 'personal')));
    const personalWatchCandidates = await detectRecurringWatchCandidates(user.id, { scope: 'personal' });
    insightSets.push(
      personalWatchCandidates
        .filter((candidate) => candidate.status === 'watching' || candidate.status === 'due_today' || candidate.status === 'overdue')
        .slice(0, 3)
        .map((candidate) => toRepurchaseDueInsight(candidate, 'personal'))
    );
    const personalWatchOpportunities = await findObservationOpportunities(user.id, { scope: 'personal' });
    insightSets.push(
      personalWatchOpportunities
        .slice(0, 3)
        .map((opportunity) => toBuySoonBetterPriceInsight(opportunity, 'personal'))
    );

    const personalSpikeSignals = personalRecurringSignals.filter((signal) => signal.signal === 'price_spike');
    const personalTotalRecurringDelta = personalSpikeSignals.reduce((sum, signal) => sum + Math.max(Number(signal.delta_amount || 0), 0), 0);
    const personalMaxRecurringDeltaPercent = personalSpikeSignals.reduce(
      (max, signal) => Math.max(max, Math.abs(Number(signal.delta_percent || 0))),
      0
    );
    if (personalSpikeSignals.length >= 2 || personalTotalRecurringDelta >= 2 || personalMaxRecurringDeltaPercent >= 15) {
      const topItems = personalSpikeSignals
        .slice()
        .sort((a, b) => Math.abs(Number(b.delta_amount || 0)) - Math.abs(Number(a.delta_amount || 0)))
        .slice(0, 2)
        .map((signal) => signal.item_name);
      const topSpikeSignals = personalSpikeSignals
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
        id: `recurring_cost_pressure:${user.id}:${personalSpikeSignals.map((signal) => signal.group_key).join('|')}`,
        type: 'recurring_cost_pressure',
        title: 'Recurring items are getting more expensive',
        body: topItems.length
          ? `${topItems.join(' and ')} are above their usual price, adding about $${Number(personalTotalRecurringDelta.toFixed(2))} of extra spend versus your recent baseline.`
          : `Several recurring items are above their usual price, adding about $${Number(personalTotalRecurringDelta.toFixed(2))} of extra spend versus your recent baseline.`,
        severity: personalTotalRecurringDelta >= 10 || personalSpikeSignals.length >= 3 ? 'high' : 'medium',
        entity_type: 'user',
        entity_id: user.id,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          scope: 'personal',
          spike_count: personalSpikeSignals.length,
          total_delta_amount: Number(personalTotalRecurringDelta.toFixed(2)),
          items: topItems,
          recurring_spike_signals: topSpikeSignals,
          continuity_key: `recurring_cost_pressure:personal:${user.id}`,
        },
        actions: [],
      }]);
    }

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
    insightSets.push(buildRestockWindowInsights({ projection: personalProjection, watchCandidates: personalWatchCandidates, scope: 'personal' }));
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
    insightSets.push(buildRestockWindowInsights({ projection: householdProjection, watchCandidates: householdWatchCandidates, scope: 'household' }));
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

  return resolveInsightCompetition(deduped)
    .map((insight) => annotateInsightWithPlannerTiming(insight, timingPreferences))
    .map(annotateInsightScopeLineage)
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
  const allEvents = [...recentEvents, ...inferredEvents];
  const feedbackSummary = summarizeFeedbackEvents(allEvents);
  const outcomeWindows = summarizeOutcomeWindows(allEvents);
  const preferenceSummary = buildInsightPreferenceSummary(allEvents, { outcomeWindows });
  const dismissedContinuityKeys = buildDismissedContinuityKeySet(recentEvents);

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
    .filter((insight) => {
      const continuityKey = `${insight?.metadata?.continuity_key || ''}`.trim();
      return !continuityKey || !dismissedContinuityKeys.has(continuityKey);
    })
    .filter((insight) => !shouldSuppressInsight(insight, feedbackSummary))
    .map((insight) => ({
      insight,
      scoring: insightSurfaceDecision(insight, feedbackSummary, preferenceSummary),
    }))
    .filter(({ scoring }) => scoring.eligible)
    .map(({ insight, scoring }) => ({
      ...insight,
      metadata: {
        ...(insight.metadata || {}),
        scoring,
      },
    }))
    .sort((a, b) => {
      const scoreDiff = insightRankScore(b, feedbackSummary, preferenceSummary) - insightRankScore(a, feedbackSummary, preferenceSummary);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const explorationRanked = promoteExplorationCandidate(ranked, preferenceSummary, limit);

  let supplementedRanked = explorationRanked;
  if (shouldSupplementWithUsageFallback(explorationRanked)) {
    const fallbackScope = determineUsageFallbackScope(explorationRanked, user);
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

    supplementedRanked = resolveInsightCompetition(dedupeInsights([...explorationRanked, ...fallbackInsights]))
      .map(annotateInsightScopeLineage)
      .map((insight) => ({
        ...insight,
        metadata: {
          ...(insight.metadata || {}),
          scoring: insightSurfaceDecision(insight, feedbackSummary, preferenceSummary),
        },
      }))
      .filter((insight) => insight.metadata?.scoring?.eligible)
      .sort((a, b) => {
        const scoreDiff = insightRankScore(b, feedbackSummary, preferenceSummary) - insightRankScore(a, feedbackSummary, preferenceSummary);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    supplementedRanked = promoteExplorationCandidate(supplementedRanked, preferenceSummary, limit);
  }

  return orchestrateInsightPortfolio(supplementedRanked, feedbackSummary, limit, preferenceSummary);
}

module.exports = {
  USAGE_INSIGHT_THRESHOLDS,
  buildInsights,
  buildInsightsForUser,
  buildInsightDebugForUser,
  buildInsightPreferencesForUser,
  buildEarlyUsageInsights,
  buildDevelopingUsageInsights,
  summarizeExpenseRows,
  summarizeInsightList,
  tierGateSummary,
  insightContinuityKey,
  scopeAgnosticContinuityKey,
  resolveMaturityCompetition,
  resolveScopeOverlapCompetition,
  resolveInsightCompetition,
  buildUsageFallbackInsights,
  shouldSupplementWithUsageFallback,
  determineUsageFallbackScope,
  scoreInsightCandidate,
  insightSurfaceDecision,
  summarizeSurfaceDecisions,
  compareRankingStrategies,
  insightRankScore,
  scopeHierarchyAdjustment,
  promoteExplorationCandidate,
  insightDestinationAdjustment,
  portfolioRole,
  portfolioFamily,
  narrativeClusterKey,
  narrativeTheme,
  orchestrateInsightPortfolio,
};
