const db = require('../db');
const BudgetSetting = require('../models/budgetSetting');
const Household = require('../models/household');
const { detectRecurringItems } = require('./recurringDetector');

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateOnly(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  }
  const [year, month, day] = `${value}`.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(start, endExclusive) {
  return Math.round((endExclusive - start) / (1000 * 60 * 60 * 24));
}

function periodBounds(month, startDay = 1) {
  const [year, mon] = month.split('-').map(Number);
  const fromDate = new Date(year, mon - 1, startDay, 12, 0, 0, 0);
  const toDate = new Date(year, mon, startDay, 12, 0, 0, 0);
  return {
    from: dateOnly(fromDate),
    to: dateOnly(toDate),
    fromDate,
    toDate,
  };
}

function shiftPeriod(month, deltaMonths) {
  const [year, mon] = month.split('-').map(Number);
  const shifted = new Date(year, mon - 1 + deltaMonths, 1, 12, 0, 0, 0);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

function compareDateOnly(a, b) {
  return parseDateOnly(a).getTime() - parseDateOnly(b).getTime();
}

function currentPeriod(startDay = 1) {
  const now = new Date();
  if (now.getDate() >= startDay) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12, 0, 0, 0);
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function getCurrentPeriodDayIndex(bounds, todayWithin = new Date()) {
  const effectiveDate = new Date(Math.min(todayWithin.getTime(), addDays(bounds.toDate, -1).getTime()));
  effectiveDate.setHours(12, 0, 0, 0);
  return Math.max(1, diffDays(bounds.fromDate, addDays(effectiveDate, 1)));
}

function qualifiesHistoricalPeriod(activity) {
  return Number(activity?.expense_count || 0) >= 3 && Number(activity?.active_day_count || 0) >= 2;
}

function getCompletedHistoricalPeriods({
  targetMonth,
  startDay = 1,
  firstConfirmedExpenseAt = null,
  monthsBack = 6,
  activityByMonth = {},
}) {
  const periods = [];
  for (let i = 1; i <= monthsBack; i++) {
    const month = shiftPeriod(targetMonth, -i);
    const bounds = periodBounds(month, startDay);
    if (firstConfirmedExpenseAt && bounds.fromDate < firstConfirmedExpenseAt) continue;
    const activity = activityByMonth[month];
    if (activity && !qualifiesHistoricalPeriod(activity)) continue;
    periods.push({ month, ...bounds, activity: activity || null });
  }
  return periods;
}

function normalizeExpenseRow(expense) {
  return {
    ...expense,
    merchant: expense.merchant || 'Unknown',
    amount: Number(expense.amount || 0),
    category_key: expense.category_key || 'uncategorized',
    category_name: expense.category_name || 'Uncategorized',
    date: typeof expense.date === 'string' ? expense.date.slice(0, 10) : dateOnly(parseDateOnly(expense.date)),
  };
}

function buildHistoricalCumulativeCurve(periods, targetTotalDays) {
  if (!periods.length || !targetTotalDays) return { shares: [], period_count: 0 };

  const perPeriodShares = periods.map((period) => {
    const totalDays = diffDays(period.fromDate, period.toDate);
    const daily = Array.from({ length: totalDays }, () => 0);
    const expenses = (period.expenses || []).map(normalizeExpenseRow);
    expenses.forEach((expense) => {
      const index = diffDays(period.fromDate, addDays(parseDateOnly(expense.date), 1)) - 1;
      if (index >= 0 && index < totalDays) {
        daily[index] += expense.amount;
      }
    });

    const total = daily.reduce((sum, amount) => sum + amount, 0);
    if (total <= 0) {
      return Array.from({ length: totalDays }, () => 0);
    }

    let running = 0;
    return daily.map((amount) => {
      running += amount;
      return running / total;
    });
  });

  const shares = Array.from({ length: targetTotalDays }, (_, index) => {
    const day = index + 1;
    const values = perPeriodShares.map((curve) => {
      if (!curve.length) return 0;
      if (day <= curve.length) return curve[day - 1];
      return 1;
    });
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });

  return { shares, period_count: periods.length };
}

function filterExpensesByCategory(expenses, categoryKey) {
  return (expenses || []).filter((expense) => {
    const normalized = normalizeExpenseRow(expense);
    return normalized.category_key === categoryKey;
  });
}

function buildHistoricalCategoryCurves(periods, targetTotalDays) {
  const categoryKeys = Array.from(new Set(
    periods.flatMap((period) => (period.expenses || []).map((expense) => normalizeExpenseRow(expense).category_key))
  ));

  return categoryKeys.reduce((acc, categoryKey) => {
    const categoryPeriods = periods
      .map((period) => ({
        ...period,
        expenses: filterExpensesByCategory(period.expenses, categoryKey),
      }))
      .filter((period) => (period.expenses || []).length > 0);

    if (!categoryPeriods.length) return acc;

    acc[categoryKey] = buildHistoricalCumulativeCurve(categoryPeriods, targetTotalDays);
    return acc;
  }, {});
}

function getExpectedCumulativeShareByDay(curve, dayIndex) {
  if (!curve?.shares?.length) return null;
  const index = Math.max(1, Math.min(dayIndex, curve.shares.length));
  return curve.shares[index - 1] || null;
}

function classifyExpenseNormStatus(expense, context = {}) {
  const normalized = normalizeExpenseRow(expense);
  const historicalExpenses = (context.historicalExpenses || []).map(normalizeExpenseRow);
  const historicalAmounts = historicalExpenses
    .map((row) => Math.abs(Number(row.amount || 0)))
    .filter((value) => value > 0);
  const overallMedian = median(historicalAmounts) || Math.abs(normalized.amount) || 1;

  const categoryExpenses = historicalExpenses.filter((row) => row.category_key === normalized.category_key);
  const categoryMedian = median(categoryExpenses.map((row) => Math.abs(row.amount)).filter(Boolean)) || overallMedian;
  const merchantExpenses = historicalExpenses.filter(
    (row) => (row.merchant || '').trim().toLowerCase() === (normalized.merchant || '').trim().toLowerCase()
  );

  const novelty = merchantExpenses.length === 0;
  const rarity = categoryExpenses.length < 2;
  const amount = Math.abs(normalized.amount);

  let status = 'normal';
  let reason = 'within_normal_range';

  if (amount >= categoryMedian * 4 || amount >= overallMedian * 5) {
    status = 'outlier';
    reason = 'amount_far_above_historical_range';
  } else if (
    amount >= categoryMedian * 2.5 ||
    amount >= overallMedian * 3 ||
    (novelty && amount >= overallMedian * 1.75) ||
    (rarity && amount >= categoryMedian * 1.75)
  ) {
    status = 'unusual';
    reason = novelty
      ? 'novel_merchant_with_large_amount'
      : 'amount_above_historical_range';
  }

  return {
    status,
    reason,
    novelty,
    rarity,
    amount,
    category_median: categoryMedian,
    overall_median: overallMedian,
  };
}

function getTopUnusualExpenses(unusualExpenses, limit = 3) {
  return [...unusualExpenses]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, limit)
    .map((expense) => ({
      id: expense.id || null,
      merchant: expense.merchant,
      amount: Number(expense.amount || 0),
      category_key: expense.category_key || 'uncategorized',
      category_name: expense.category_name || 'Uncategorized',
      norm_status: expense.norm_status,
      norm_reason: expense.norm_reason,
      date: expense.date,
    }));
}

function splitNormalVsUnusualSpend(currentExpenses, context = {}) {
  const classified = currentExpenses.map((expense) => {
    const normalized = normalizeExpenseRow(expense);
    const norm = classifyExpenseNormStatus(normalized, context);
    return {
      ...normalized,
      norm_status: norm.status,
      norm_reason: norm.reason,
    };
  });

  const unusualExpenses = classified.filter((expense) => expense.norm_status !== 'normal');
  const normalExpenses = classified.filter((expense) => expense.norm_status === 'normal');

  return {
    normal_spend_to_date: normalExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    unusual_spend_to_date: unusualExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    unusual_spend_share: classified.length
      ? unusualExpenses.reduce((sum, expense) => sum + Math.abs(expense.amount), 0)
        / Math.max(classified.reduce((sum, expense) => sum + Math.abs(expense.amount), 0), 1)
      : 0,
    normal_expenses: normalExpenses,
    unusual_expenses: unusualExpenses,
    top_unusual_expenses: getTopUnusualExpenses(unusualExpenses),
  };
}

function projectCategorySpend({
  categoryKey,
  categoryName,
  currentExpenses = [],
  historicalPeriods = [],
  bounds,
  dayIndex,
}) {
  const totalDays = diffDays(bounds.fromDate, bounds.toDate);
  const filteredCurrentExpenses = filterExpensesByCategory(currentExpenses, categoryKey);
  const filteredHistoricalPeriods = historicalPeriods
    .map((period) => ({
      ...period,
      expenses: filterExpensesByCategory(period.expenses, categoryKey),
    }))
    .filter((period) => (period.expenses || []).length > 0);

  if (filteredHistoricalPeriods.length < 3) {
    return null;
  }

  const curve = buildHistoricalCumulativeCurve(filteredHistoricalPeriods, totalDays);
  const expectedShare = getExpectedCumulativeShareByDay(curve, dayIndex);
  const historicalExpenses = filteredHistoricalPeriods.flatMap((period) => period.expenses || []);
  const historicalAverageTotal = filteredHistoricalPeriods.length
    ? filteredHistoricalPeriods.reduce(
      (sum, period) => sum + (period.expenses || []).reduce((periodSum, expense) => periodSum + Number(expense.amount || 0), 0),
      0
    ) / filteredHistoricalPeriods.length
    : null;
  const split = splitNormalVsUnusualSpend(filteredCurrentExpenses, { historicalExpenses });

  if (!expectedShare || expectedShare < 0.05) {
    return null;
  }

  const baseline = split.normal_spend_to_date / expectedShare;
  const adjusted = baseline + split.unusual_spend_to_date;
  const confidence = projectionConfidence({
    historicalPeriodCount: filteredHistoricalPeriods.length,
    unusualSpendShare: split.unusual_spend_share,
    expectedShare,
    dayIndex,
    totalDays,
  });

  return {
    category_key: categoryKey,
    category_name: categoryName || historicalExpenses[0]?.category_name || 'Uncategorized',
    current_spend_to_date: filteredCurrentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    normal_spend_to_date: split.normal_spend_to_date,
    unusual_spend_to_date: split.unusual_spend_to_date,
    unusual_spend_share: split.unusual_spend_share,
    historical_expected_share_by_day: expectedShare,
    baseline_projected_total: baseline,
    adjusted_projected_total: adjusted,
    projection_excluding_unusuals: baseline,
    confidence,
    historical_period_count: filteredHistoricalPeriods.length,
    historical_average_total: historicalAverageTotal,
    top_unusual_expenses: split.top_unusual_expenses,
  };
}

function getTopProjectedCategoryPressures({
  currentExpenses = [],
  historicalPeriods = [],
  bounds,
  dayIndex,
  limit = 3,
}) {
  const categoryMap = new Map();
  currentExpenses.forEach((expense) => {
    const normalized = normalizeExpenseRow(expense);
    if (!categoryMap.has(normalized.category_key)) {
      categoryMap.set(normalized.category_key, normalized.category_name);
    }
  });

  return Array.from(categoryMap.entries())
    .map(([categoryKey, categoryName]) => projectCategorySpend({
      categoryKey,
      categoryName,
      currentExpenses,
      historicalPeriods,
      bounds,
      dayIndex,
    }))
    .filter(Boolean)
    .sort((a, b) => Number(b.adjusted_projected_total || 0) - Number(a.adjusted_projected_total || 0))
    .slice(0, limit);
}

function projectionConfidence({ historicalPeriodCount, unusualSpendShare, expectedShare, dayIndex, totalDays }) {
  if (historicalPeriodCount <= 0 || !expectedShare || expectedShare < 0.05) return null;
  if (historicalPeriodCount < 3 || expectedShare < 0.12) return 'very_low';
  const progress = totalDays ? dayIndex / totalDays : 0;
  if (historicalPeriodCount >= 5 && unusualSpendShare < 0.25 && progress >= 0.2) return 'high';
  if (historicalPeriodCount >= 3 && unusualSpendShare < 0.45 && progress >= 0.1) return 'medium';
  return 'low';
}

function historyStage(historicalPeriodCount) {
  const count = Number(historicalPeriodCount || 0);
  if (count <= 0) return 'none';
  if (count < 3) return 'early';
  if (count < 5) return 'developing';
  return 'established';
}

function buildScenarioCaveats({ overall, recurringPressure }) {
  const caveats = [];
  const historicalPeriodCount = Number(overall?.historical_period_count || 0);
  const confidence = overall?.confidence || null;

  if (historicalPeriodCount === 0) {
    caveats.push('No completed budget periods yet.');
  } else if (historicalPeriodCount < 3) {
    caveats.push(`Only ${historicalPeriodCount} completed budget ${historicalPeriodCount === 1 ? 'period' : 'periods'} so far.`);
  }

  if (confidence === 'very_low') {
    caveats.push('Projection is still stabilizing from limited period history.');
  } else if (confidence === 'low') {
    caveats.push('This month still looks somewhat variable versus prior periods.');
  }

  if (Number(recurringPressure?.count || 0) > 0) {
    caveats.push('Upcoming recurring purchases could still tighten the month.');
  }

  return caveats;
}

function estimateRemainingRecurringPressure({ candidates = [], periodEnd }) {
  const periodEndDate = parseDateOnly(periodEnd);
  const dueCandidates = (candidates || [])
    .filter((candidate) => {
      if (!candidate?.next_expected_date || candidate.median_amount == null) return false;
      const nextExpectedDate = parseDateOnly(candidate.next_expected_date);
      return nextExpectedDate < periodEndDate;
    })
    .map((candidate) => ({
      group_key: candidate.group_key,
      item_name: candidate.item_name || 'Recurring purchase',
      next_expected_date: candidate.next_expected_date,
      median_amount: Number(candidate.median_amount || 0),
      status: candidate.status,
      days_until_due: Number(candidate.days_until_due || 0),
    }))
    .filter((candidate) => candidate.median_amount > 0)
    .sort((a, b) => a.days_until_due - b.days_until_due || b.median_amount - a.median_amount);

  return {
    count: dueCandidates.length,
    total_expected_amount: dueCandidates.reduce((sum, candidate) => sum + candidate.median_amount, 0),
    candidates: dueCandidates.slice(0, 5),
  };
}

function estimateRecurringPressureWithinBounds({ candidates = [], bounds }) {
  const periodStart = parseDateOnly(bounds.from);
  const periodEnd = parseDateOnly(bounds.to);
  const dueCandidates = [];

  for (const candidate of candidates || []) {
    if (!candidate?.next_expected_date || !candidate?.average_gap_days || candidate.median_amount == null) continue;
    let cursor = parseDateOnly(candidate.next_expected_date);
    const gapDays = Number(candidate.average_gap_days || 0);
    if (!(gapDays > 0)) continue;

    while (cursor < periodStart) {
      cursor = addDays(cursor, gapDays);
    }

    while (cursor < periodEnd) {
      dueCandidates.push({
        group_key: candidate.group_key,
        item_name: candidate.item_name || 'Recurring purchase',
        next_expected_date: dateOnly(cursor),
        median_amount: Number(candidate.median_amount || 0),
        status: 'upcoming',
        days_until_due: diffDays(periodStart, cursor),
      });
      cursor = addDays(cursor, gapDays);
    }
  }

  return {
    count: dueCandidates.length,
    total_expected_amount: dueCandidates.reduce((sum, candidate) => sum + candidate.median_amount, 0),
    candidates: dueCandidates
      .sort((a, b) => compareDateOnly(a.next_expected_date, b.next_expected_date) || b.median_amount - a.median_amount)
      .slice(0, 5),
  };
}

function timingModeLabel(mode) {
  switch (mode) {
    case 'next_period': return 'Next period';
    case 'spread_3_periods': return 'Spread over 3 periods';
    default: return 'This period';
  }
}

function statusRank(status) {
  switch (status) {
    case 'not_absorbable': return 5;
    case 'risky': return 4;
    case 'tight': return 3;
    case 'absorbable': return 2;
    case 'comfortable': return 1;
    default: return 0;
  }
}

function evaluateScenarioAgainstProjection({
  projection,
  proposedAmount,
  label = 'purchase',
  recurringPressure = { count: 0, total_expected_amount: 0, candidates: [] },
}) {
  const amount = Number(proposedAmount || 0);
  if (!projection?.overall || !(amount > 0)) {
    return {
      label,
      proposed_amount: amount > 0 ? amount : null,
      status: 'unknown',
      can_absorb: null,
      reason: 'missing_projection_or_amount',
    };
  }

  const overall = projection.overall;
  const projectedBudgetDelta = Number(overall.projected_budget_delta || 0);
  const projectedHeadroomAmount = projectedBudgetDelta < 0 ? Math.abs(projectedBudgetDelta) : 0;
  const postPurchaseProjectedDelta = projectedBudgetDelta + amount;
  const postPurchaseHeadroomAmount = postPurchaseProjectedDelta < 0 ? Math.abs(postPurchaseProjectedDelta) : 0;
  const recurringPressureAmount = Number(recurringPressure?.total_expected_amount || 0);
  const riskAdjustedHeadroomAmount = Math.max(0, postPurchaseHeadroomAmount - recurringPressureAmount);

  let status = 'tight';
  let canAbsorb = false;
  let reason = 'projected_over_budget_after_purchase';

  const historicalPeriodCount = Number(overall.historical_period_count || 0);
  const confidence = overall.confidence ?? null;
  const stage = historyStage(historicalPeriodCount);
  const caveats = buildScenarioCaveats({ overall, recurringPressure });

  if (projectedBudgetDelta == null || confidence == null) {
    status = 'unknown';
    canAbsorb = null;
    reason = 'insufficient_history';
  } else if (postPurchaseProjectedDelta > 75) {
    status = 'not_absorbable';
    canAbsorb = false;
    reason = 'projected_over_budget_after_purchase';
  } else if (postPurchaseProjectedDelta > 0) {
    status = 'risky';
    canAbsorb = false;
    reason = 'headroom_consumed';
  } else if (riskAdjustedHeadroomAmount >= Math.max(75, amount * 0.5)) {
    status = 'comfortable';
    canAbsorb = true;
    reason = 'projected_headroom_remains';
  } else if (postPurchaseHeadroomAmount > 0) {
    status = recurringPressureAmount > 0 ? 'tight' : 'absorbable';
    canAbsorb = true;
    reason = recurringPressureAmount > 0 ? 'limited_headroom_after_recurring_pressure' : 'limited_but_positive_headroom';
  }

  return {
    label,
    proposed_amount: amount,
    status,
    can_absorb: canAbsorb,
    reason,
    projection_confidence: confidence,
    history_stage: stage,
    historical_period_count: historicalPeriodCount,
    caveats,
    projected_headroom_amount: projectedHeadroomAmount,
    post_purchase_projected_delta: postPurchaseProjectedDelta,
    post_purchase_headroom_amount: postPurchaseHeadroomAmount,
    risk_adjusted_headroom_amount: riskAdjustedHeadroomAmount,
    recurring_pressure_count: Number(recurringPressure?.count || 0),
    recurring_pressure_amount: recurringPressureAmount,
    recurring_candidates: recurringPressure?.candidates || [],
  };
}

function summarizeScenarioEvaluations({ mode, evaluations = [], totalAmount, label }) {
  const ordered = [...evaluations].sort((a, b) => statusRank(b.scenario?.status) - statusRank(a.scenario?.status));
  const worst = ordered[0] || null;
  if (!worst) {
    return {
      label,
      proposed_amount: Number(totalAmount || 0),
      status: 'unknown',
      can_absorb: null,
      reason: 'insufficient_history',
      timing_mode: mode,
      timing_label: timingModeLabel(mode),
      horizon_periods: [],
      projection_confidence: null,
      history_stage: 'none',
      historical_period_count: 0,
      caveats: ['Not enough history yet to evaluate this plan.'],
    };
  }

  const scenarios = evaluations.map((entry) => entry.scenario || {});
  const confidences = scenarios.map((scenario) => scenario.projection_confidence).filter(Boolean);
  const historicalCounts = scenarios.map((scenario) => Number(scenario.historical_period_count || 0));
  const caveats = Array.from(new Set(scenarios.flatMap((scenario) => scenario.caveats || [])));

  let overallCanAbsorb = scenarios.every((scenario) => scenario.can_absorb !== false);
  if (scenarios.some((scenario) => scenario.can_absorb == null)) {
    overallCanAbsorb = null;
  }

  const confidence = confidences.includes('very_low')
    ? 'very_low'
    : confidences.includes('low')
      ? 'low'
      : confidences.includes('medium')
        ? 'medium'
        : confidences.includes('high')
          ? 'high'
          : null;

  return {
    ...worst.scenario,
    label,
    proposed_amount: Number(totalAmount || 0),
    can_absorb: overallCanAbsorb,
    timing_mode: mode,
    timing_label: timingModeLabel(mode),
    horizon_periods: evaluations.map((entry) => ({
      month: entry.month,
      label: entry.period_label,
      applied_amount: entry.applied_amount,
      status: entry.scenario?.status || null,
      projected_headroom_amount: entry.scenario?.projected_headroom_amount ?? null,
      post_purchase_headroom_amount: entry.scenario?.post_purchase_headroom_amount ?? null,
      risk_adjusted_headroom_amount: entry.scenario?.risk_adjusted_headroom_amount ?? null,
      recurring_pressure_amount: entry.scenario?.recurring_pressure_amount ?? null,
    })),
    projection_confidence: confidence,
    history_stage: historicalCounts.some((count) => count <= 0)
      ? 'none'
      : historicalCounts.some((count) => count < 3)
        ? 'early'
        : historicalCounts.some((count) => count < 5)
          ? 'developing'
          : 'established',
    historical_period_count: historicalCounts.length ? Math.min(...historicalCounts) : 0,
    caveats,
  };
}

function projectOverallSpend({
  currentExpenses = [],
  historicalPeriods = [],
  bounds,
  dayIndex,
  budgetLimit = null,
}) {
  const totalDays = diffDays(bounds.fromDate, bounds.toDate);
  if (historicalPeriods.length === 0) {
    return {
      current_spend_to_date: currentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
      normal_spend_to_date: null,
      unusual_spend_to_date: null,
      historical_expected_share_by_day: null,
      baseline_projected_total: null,
      adjusted_projected_total: null,
      projection_excluding_unusuals: null,
      projected_budget_delta: null,
      confidence: null,
      historical_period_count: historicalPeriods.length,
      history_stage: historyStage(historicalPeriods.length),
      top_unusual_expenses: [],
    };
  }

  const curve = buildHistoricalCumulativeCurve(historicalPeriods, totalDays);
  const expectedShare = getExpectedCumulativeShareByDay(curve, dayIndex);
  const historicalExpenses = historicalPeriods.flatMap((period) => period.expenses || []);
  const split = splitNormalVsUnusualSpend(currentExpenses, { historicalExpenses });

  if (!expectedShare || expectedShare < 0.05) {
    return {
      current_spend_to_date: currentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
      normal_spend_to_date: split.normal_spend_to_date,
      unusual_spend_to_date: split.unusual_spend_to_date,
      historical_expected_share_by_day: expectedShare,
      baseline_projected_total: null,
      adjusted_projected_total: null,
      projection_excluding_unusuals: null,
      projected_budget_delta: null,
      confidence: projectionConfidence({
        historicalPeriodCount: historicalPeriods.length,
        unusualSpendShare: split.unusual_spend_share,
        expectedShare,
        dayIndex,
        totalDays,
      }),
      historical_period_count: historicalPeriods.length,
      history_stage: historyStage(historicalPeriods.length),
      top_unusual_expenses: split.top_unusual_expenses,
    };
  }

  const baseline = split.normal_spend_to_date / expectedShare;
  const adjusted = baseline + split.unusual_spend_to_date;
  const confidence = projectionConfidence({
    historicalPeriodCount: historicalPeriods.length,
    unusualSpendShare: split.unusual_spend_share,
    expectedShare,
    dayIndex,
    totalDays,
  });

  return {
    current_spend_to_date: currentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    normal_spend_to_date: split.normal_spend_to_date,
    unusual_spend_to_date: split.unusual_spend_to_date,
    unusual_spend_share: split.unusual_spend_share,
    historical_expected_share_by_day: expectedShare,
    baseline_projected_total: baseline,
    adjusted_projected_total: adjusted,
    projection_excluding_unusuals: baseline,
    projected_budget_delta: budgetLimit != null ? adjusted - budgetLimit : null,
    confidence,
    historical_period_count: historicalPeriods.length,
    history_stage: historyStage(historicalPeriods.length),
    top_unusual_expenses: split.top_unusual_expenses,
  };
}

async function listExpensesInPeriod({ scope, householdId, userId, from, toExclusive }) {
  if (scope === 'household') {
    const result = await db.query(
      `SELECT
         e.id,
         e.merchant,
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
      [householdId, from, toExclusive]
    );
    return result.rows.map(normalizeExpenseRow);
  }

  const result = await db.query(
    `SELECT
       e.id,
       e.merchant,
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
    [userId, from, toExclusive]
  );
  return result.rows.map(normalizeExpenseRow);
}

async function periodActivity({ scope, householdId, userId, from, toExclusive }) {
  if (scope === 'household') {
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS expense_count,
         COUNT(DISTINCT e.date)::int AS active_day_count
       FROM expenses e
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND e.status = 'confirmed'
         AND e.date >= $2
         AND e.date < $3`,
      [householdId, from, toExclusive]
    );
    return {
      expense_count: Number(result.rows[0]?.expense_count || 0),
      active_day_count: Number(result.rows[0]?.active_day_count || 0),
    };
  }

  const result = await db.query(
    `SELECT
       COUNT(*)::int AS expense_count,
       COUNT(DISTINCT date)::int AS active_day_count
     FROM expenses
     WHERE user_id = $1
       AND status = 'confirmed'
       AND date >= $2
       AND date < $3`,
    [userId, from, toExclusive]
  );
  return {
    expense_count: Number(result.rows[0]?.expense_count || 0),
    active_day_count: Number(result.rows[0]?.active_day_count || 0),
  };
}

async function getTotalBudgetLimit({ scope, householdId, userId }) {
  if (scope === 'household') {
    const settings = await BudgetSetting.findByHousehold(householdId);
    const total = settings.find((row) => row.category_id === null);
    return total ? Number(total.monthly_limit) : null;
  }
  const settings = await BudgetSetting.findByUser(userId);
  const total = settings.find((row) => row.category_id === null);
  return total ? Number(total.monthly_limit) : null;
}

async function getFirstConfirmedExpenseDate({ scope, householdId, userId }) {
  if (scope === 'household') {
    const result = await db.query(
      `SELECT MIN(e.date) AS first_date
       FROM expenses e
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND e.status = 'confirmed'`,
      [householdId]
    );
    return result.rows[0]?.first_date || null;
  }

  const result = await db.query(
    `SELECT MIN(date) AS first_date
     FROM expenses
     WHERE user_id = $1
       AND status = 'confirmed'`,
    [userId]
  );
  return result.rows[0]?.first_date || null;
}

async function analyzeSpendProjection({ user, scope = 'personal', month = null }) {
  const effectiveScope = scope === 'household' && user.household_id ? 'household' : 'personal';
  let startDay = user.budget_start_day || 1;
  if (effectiveScope === 'household') {
    const household = await Household.findById(user.household_id);
    startDay = household?.budget_start_day || startDay;
  }

  const targetMonth = month || currentPeriod(startDay);
  const bounds = periodBounds(targetMonth, startDay);
  const firstConfirmedExpenseDate = await getFirstConfirmedExpenseDate({
    scope: effectiveScope,
    householdId: user.household_id,
    userId: user.id,
  });
  const firstConfirmedExpenseAt = firstConfirmedExpenseDate ? parseDateOnly(firstConfirmedExpenseDate) : null;
  const dayIndex = getCurrentPeriodDayIndex(bounds);
  const currentExpenses = await listExpensesInPeriod({
    scope: effectiveScope,
    householdId: user.household_id,
    userId: user.id,
    from: bounds.from,
    toExclusive: dateOnly(addDays(bounds.fromDate, dayIndex)),
  });

  const activityByMonth = {};
  for (let i = 1; i <= 6; i++) {
    const historicalMonth = shiftPeriod(targetMonth, -i);
    const historicalBounds = periodBounds(historicalMonth, startDay);
    const activity = await periodActivity({
      scope: effectiveScope,
      householdId: user.household_id,
      userId: user.id,
      from: historicalBounds.from,
      toExclusive: historicalBounds.to,
    });
    activityByMonth[historicalMonth] = activity;
  }

  const historicalPeriods = getCompletedHistoricalPeriods({
    targetMonth,
    startDay,
    firstConfirmedExpenseAt,
    monthsBack: 6,
    activityByMonth,
  });

  const hydratedHistoricalPeriods = await Promise.all(
    historicalPeriods.map(async (period) => ({
      ...period,
      expenses: await listExpensesInPeriod({
        scope: effectiveScope,
        householdId: user.household_id,
        userId: user.id,
        from: period.from,
        toExclusive: period.to,
      }),
    }))
  );

  const budgetLimit = await getTotalBudgetLimit({
    scope: effectiveScope,
    householdId: user.household_id,
    userId: user.id,
  });

  return {
    scope: effectiveScope,
    month: targetMonth,
    period: {
      month: targetMonth,
      start_day: startDay,
      day_index: dayIndex,
      days_in_period: diffDays(bounds.fromDate, bounds.toDate),
      from: bounds.from,
      to: bounds.to,
    },
    overall: projectOverallSpend({
      currentExpenses,
      historicalPeriods: hydratedHistoricalPeriods,
      bounds,
      dayIndex,
      budgetLimit,
    }),
    categories: getTopProjectedCategoryPressures({
      currentExpenses,
      historicalPeriods: hydratedHistoricalPeriods,
      bounds,
      dayIndex,
      limit: 3,
    }),
  };
}

async function evaluateScenarioAffordability({
  user,
  scope = 'personal',
  month = null,
  proposedAmount,
  label = 'purchase',
  timingMode = 'now',
}) {
  const normalizedTimingMode = ['next_period', 'spread_3_periods'].includes(timingMode) ? timingMode : 'now';
  const totalAmount = Number(proposedAmount || 0);
  const months = normalizedTimingMode === 'next_period'
    ? [shiftPeriod(month || currentPeriod(user.budget_start_day || 1), 1)]
    : normalizedTimingMode === 'spread_3_periods'
      ? [0, 1, 2].map((offset) => shiftPeriod(month || currentPeriod(user.budget_start_day || 1), offset))
      : [month || currentPeriod(user.budget_start_day || 1)];
  const perPeriodAmount = normalizedTimingMode === 'spread_3_periods'
    ? Number((totalAmount / months.length).toFixed(2))
    : totalAmount;

  const recurringItems = (scope === 'household' && user?.household_id)
    ? await detectRecurringItems(user.household_id)
    : [];

  const evaluations = [];
  for (const targetMonth of months) {
    const projection = await analyzeSpendProjection({ user, scope, month: targetMonth });
    const recurringPressure = projection.scope === 'household' && user?.household_id
      ? estimateRecurringPressureWithinBounds({
          candidates: recurringItems,
          bounds: { from: projection.period.from, to: projection.period.to },
        })
      : { count: 0, total_expected_amount: 0, candidates: [] };

    evaluations.push({
      month: projection.month,
      period_label: projection.month,
      applied_amount: perPeriodAmount,
      projection,
      scenario: evaluateScenarioAgainstProjection({
        projection,
        proposedAmount: perPeriodAmount,
        label,
        recurringPressure,
      }),
    });
  }

  const primary = evaluations[0];
  return {
    scope: primary.projection.scope,
    month: primary.projection.month,
    period: primary.projection.period,
    projection: primary.projection,
    scenario: summarizeScenarioEvaluations({
      mode: normalizedTimingMode,
      evaluations,
      totalAmount,
      label,
    }),
  };
}

module.exports = {
  analyzeSpendProjection,
  buildHistoricalCumulativeCurve,
  buildHistoricalCategoryCurves,
  classifyExpenseNormStatus,
  getCompletedHistoricalPeriods,
  getCurrentPeriodDayIndex,
  getExpectedCumulativeShareByDay,
  getTopProjectedCategoryPressures,
  estimateRemainingRecurringPressure,
  evaluateScenarioAgainstProjection,
  evaluateScenarioAffordability,
  projectOverallSpend,
  projectCategorySpend,
  splitNormalVsUnusualSpend,
  periodBounds,
};
