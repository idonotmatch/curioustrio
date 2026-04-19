const db = require('../db');

function isMissingExcludeFromBudgetError(err) {
  return err?.code === '42703' && /exclude_from_budget/i.test(`${err?.message || ''}`);
}

async function queryBudgetRelevant(sql, params, fallbackSql) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    if (!isMissingExcludeFromBudgetError(err) || !fallbackSql) throw err;
    return db.query(fallbackSql, params);
  }
}

const USAGE_INSIGHT_THRESHOLDS = {
  earlyTopCategory: {
    minSpend: 15,
    minShareOfSpend: 0.3,
    minExpenseCount: 2,
    mediumSharePercent: 55,
  },
  earlyRepeatedMerchant: {
    minSpend: 15,
    minCount: 2,
    mediumCount: 3,
  },
  earlySpendConcentration: {
    minExpenseCount: 2,
    minShareOfSpend: 0.3,
    minAmount: 20,
    mediumSharePercent: 50,
  },
  earlyCleanup: {
    minUncategorizedCount: 2,
  },
  earlyLoggingMomentum: {
    minActiveDayCount: 2,
    minExpenseCount: 3,
  },
  earlyBudgetPace: {
    tightPaceDeltaPercent: 10,
    minBudgetUsedShare: 0.1,
  },
  developing: {
    minExpenseCount: 3,
    minActiveDayCount: 2,
  },
  developingWeeklySpendChange: {
    minDeltaAmount: 25,
    minDeltaPercent: 25,
    mediumDeltaPercent: 60,
  },
  developingCategoryShift: {
    minSpend: 25,
    minCount: 2,
    minNewCategorySharePercent: 30,
    minDeltaAmount: 20,
    minDeltaRatio: 0.5,
    mediumSharePercent: 55,
  },
  developingRepeatedMerchant: {
    minCount: 2,
    minSpend: 20,
    mediumCount: 3,
  },
};

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

function isUnknownMerchant(merchant = {}) {
  const merchantKey = `${merchant?.merchant_key || ''}`.trim().toLowerCase();
  const merchantName = `${merchant?.merchant_name || ''}`.trim().toLowerCase();
  return merchantKey === 'unknown' || merchantName === 'unknown';
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
  const topMerchant = activity.top_merchants?.find((merchant) =>
    !isUnknownMerchant(merchant)
    && Number(merchant.spend || 0) >= USAGE_INSIGHT_THRESHOLDS.earlyRepeatedMerchant.minSpend
    && Number(merchant.count || 0) >= USAGE_INSIGHT_THRESHOLDS.earlyRepeatedMerchant.minCount
  );
  const largestExpense = activity.largest_expense;

  if (Number(budgetLimit) > 0) {
    const budgetUsedPercent = Number(((totalSpend / Number(budgetLimit)) * 100).toFixed(1));
    const expectedUsedPercent = periodShare == null ? null : Number((periodShare * 100).toFixed(1));
    const paceIsTight = expectedUsedPercent != null
      && budgetUsedPercent >= expectedUsedPercent + USAGE_INSIGHT_THRESHOLDS.earlyBudgetPace.tightPaceDeltaPercent
      && totalSpend >= Number(budgetLimit) * USAGE_INSIGHT_THRESHOLDS.earlyBudgetPace.minBudgetUsedShare;
    insights.push({
      id: `early_budget_pace:${scopeLabel}:${projection.month}:${Math.round(totalSpend)}:${Math.round(Number(budgetLimit))}`,
      type: 'early_budget_pace',
      title: scope === 'household' ? 'Shared spending is moving quickly early' : 'You are using budget room quickly early',
      body: daysRemaining == null
        ? `You have already used ${budgetUsedPercent}% of your ${scopeLabel} budget.`
        : `You have already used ${budgetUsedPercent}% of your ${scopeLabel} budget with ${daysRemaining} days left in this period.`,
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

  if (
    topCategory
    && Number(topCategory.spend || 0) >= Math.max(
      USAGE_INSIGHT_THRESHOLDS.earlyTopCategory.minSpend,
      totalSpend * USAGE_INSIGHT_THRESHOLDS.earlyTopCategory.minShareOfSpend
    )
    && expenseCount >= USAGE_INSIGHT_THRESHOLDS.earlyTopCategory.minExpenseCount
  ) {
    const share = Number(((Number(topCategory.spend || 0) / totalSpend) * 100).toFixed(1));
    insights.push({
      id: `early_top_category:${scopeLabel}:${projection.month}:${topCategory.category_key}:${Math.round(Number(topCategory.spend || 0))}`,
      type: 'early_top_category',
      title: `${topCategory.category_name} is taking the biggest share so far`,
      body: `${topCategory.category_name} is already ${share}% of your ${scopeLabel} spending this period, so it is likely to shape where the rest of the month has room.`,
      severity: share >= USAGE_INSIGHT_THRESHOLDS.earlyTopCategory.mediumSharePercent ? 'medium' : 'low',
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

  if (topMerchant) {
    insights.push({
      id: `early_repeated_merchant:${scopeLabel}:${projection.month}:${topMerchant.merchant_key}:${topMerchant.count}`,
      type: 'early_repeated_merchant',
      title: `${topMerchant.merchant_name} is already becoming a pattern`,
      body: `${topMerchant.merchant_name} has shown up ${topMerchant.count} times in your ${scopeLabel} spending this period, which makes it worth watching before it becomes a bigger habit.`,
      severity: Number(topMerchant.count || 0) >= USAGE_INSIGHT_THRESHOLDS.earlyRepeatedMerchant.mediumCount ? 'medium' : 'low',
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

  if (
    largestExpense
    && expenseCount >= USAGE_INSIGHT_THRESHOLDS.earlySpendConcentration.minExpenseCount
    && Number(largestExpense.share_of_spend || 0) >= USAGE_INSIGHT_THRESHOLDS.earlySpendConcentration.minShareOfSpend
    && Math.abs(Number(largestExpense.amount || 0)) >= USAGE_INSIGHT_THRESHOLDS.earlySpendConcentration.minAmount
  ) {
    const share = Number((Number(largestExpense.share_of_spend || 0) * 100).toFixed(1));
    insights.push({
      id: `early_spend_concentration:${scopeLabel}:${projection.month}:${largestExpense.id || largestExpense.merchant}:${Math.round(Number(largestExpense.amount || 0))}`,
      type: 'early_spend_concentration',
      title: 'One purchase is doing a lot of the work so far',
      body: `${largestExpense.merchant} already accounts for ${share}% of your ${scopeLabel} spending this period, so the current month read is more concentrated than usual.`,
      severity: share >= USAGE_INSIGHT_THRESHOLDS.earlySpendConcentration.mediumSharePercent ? 'medium' : 'low',
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

  if (Number(activity.uncategorized_count || 0) >= USAGE_INSIGHT_THRESHOLDS.earlyCleanup.minUncategorizedCount) {
    insights.push({
      id: `early_cleanup:${scopeLabel}:${projection.month}:uncategorized:${activity.uncategorized_count}`,
      type: 'early_cleanup',
      title: 'A little cleanup will make these reads sharper',
      body: `${activity.uncategorized_count} expenses are still uncategorized, which is blocking more specific guidance about where your spending is actually moving.`,
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

  if (
    activeDayCount >= USAGE_INSIGHT_THRESHOLDS.earlyLoggingMomentum.minActiveDayCount
    && expenseCount >= USAGE_INSIGHT_THRESHOLDS.earlyLoggingMomentum.minExpenseCount
  ) {
    insights.push({
      id: `early_logging_momentum:${scopeLabel}:${projection.month}:${activeDayCount}:${expenseCount}`,
      type: 'early_logging_momentum',
      title: 'You have enough activity for better reads to start forming',
      body: `You have logged ${expenseCount} expenses across ${activeDayCount} days this period, which is enough for the next round of insights to get more specific.`,
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
    const result = await queryBudgetRelevant(
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
         AND e.exclude_from_budget = FALSE
         AND e.date >= $2
         AND e.date < $3`,
      [user.household_id, from, toExclusive],
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
         AND e.date < $3`
    );
    return result.rows;
  }

  const result = await queryBudgetRelevant(
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
       AND e.exclude_from_budget = FALSE
       AND e.date >= $2
       AND e.date < $3`,
    [user.id, from, toExclusive],
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
       AND e.date < $3`
  );
  return result.rows;
}

async function analyzeRollingActivity({ user, scope = 'personal', days = 7 }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const normalizedDays = Math.max(Number(days) || 7, 1);
  const currentTo = dateOnly(addDays(today, 1));
  const currentFrom = dateOnly(addDays(today, -normalizedDays + 1));
  const previousTo = currentFrom;
  const previousFrom = dateOnly(addDays(today, -normalizedDays * 2 + 1));

  const [currentRows, previousRows] = await Promise.all([
    listRollingExpenses({ user, scope, from: currentFrom, toExclusive: currentTo }),
    listRollingExpenses({ user, scope, from: previousFrom, toExclusive: previousTo }),
  ]);

  return {
    scope: scope === 'household' && user?.household_id ? 'household' : 'personal',
    days: normalizedDays,
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

  if (
    historicalPeriodCount >= 3
    || expenseCount < USAGE_INSIGHT_THRESHOLDS.developing.minExpenseCount
    || activeDayCount < USAGE_INSIGHT_THRESHOLDS.developing.minActiveDayCount
    || currentSpend <= 0
  ) {
    return insights;
  }

  if (previousSpend > 0) {
    const deltaAmount = Number((currentSpend - previousSpend).toFixed(2));
    const deltaPercent = Number(((deltaAmount / previousSpend) * 100).toFixed(1));
    if (
      Math.abs(deltaAmount) >= USAGE_INSIGHT_THRESHOLDS.developingWeeklySpendChange.minDeltaAmount
      && Math.abs(deltaPercent) >= USAGE_INSIGHT_THRESHOLDS.developingWeeklySpendChange.minDeltaPercent
    ) {
      const increased = deltaAmount > 0;
      insights.push({
        id: `developing_weekly_spend_change:${scopeLabel}:${current.from}:${Math.round(currentSpend)}:${Math.round(previousSpend)}`,
        type: 'developing_weekly_spend_change',
        title: increased ? 'This week is running heavier than the last one' : 'This week is running lighter than the last one',
        body: increased
          ? `Your ${scopeLabel} spending in the last ${rollingActivity.days} days is about $${Math.abs(deltaAmount).toFixed(0)} higher than the prior ${rollingActivity.days}-day window, so this period may be picking up speed.`
          : `Your ${scopeLabel} spending in the last ${rollingActivity.days} days is about $${Math.abs(deltaAmount).toFixed(0)} lower than the prior ${rollingActivity.days}-day window, which is leaving a little more room than last week.`,
        severity: increased && Math.abs(deltaPercent) >= USAGE_INSIGHT_THRESHOLDS.developingWeeklySpendChange.mediumDeltaPercent ? 'medium' : 'low',
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
  if (
    topCategory
    && Number(topCategory.spend || 0) >= USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.minSpend
    && Number(topCategory.count || 0) >= USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.minCount
  ) {
    const priorSpend = Number(previousCategory?.spend || 0);
    const deltaAmount = Number((Number(topCategory.spend || 0) - priorSpend).toFixed(2));
    const share = Number(((Number(topCategory.spend || 0) / currentSpend) * 100).toFixed(1));
    if (
      (priorSpend === 0 && share >= USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.minNewCategorySharePercent)
      || (
        deltaAmount >= USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.minDeltaAmount
        && deltaAmount >= priorSpend * USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.minDeltaRatio
      )
    ) {
      insights.push({
        id: `developing_category_shift:${scopeLabel}:${current.from}:${topCategory.category_key}:${Math.round(Number(topCategory.spend || 0))}`,
        type: 'developing_category_shift',
        title: `${topCategory.category_name} is becoming the center of recent spending`,
        body: `${topCategory.category_name} is ${share}% of your ${scopeLabel} spending over the last ${rollingActivity.days} days, so it is becoming the clearest short-term driver.`,
        severity: share >= USAGE_INSIGHT_THRESHOLDS.developingCategoryShift.mediumSharePercent ? 'medium' : 'low',
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
    !isUnknownMerchant(merchant)
    && Number(merchant.spend || 0) >= USAGE_INSIGHT_THRESHOLDS.developingRepeatedMerchant.minSpend
    && Number(merchant.count || 0) >= USAGE_INSIGHT_THRESHOLDS.developingRepeatedMerchant.minCount
  );
  if (repeatedMerchant) {
    const previousMerchant = previous.top_merchants?.find((merchant) => merchant.merchant_key === repeatedMerchant.merchant_key);
    insights.push({
      id: `developing_repeated_merchant:${scopeLabel}:${current.from}:${repeatedMerchant.merchant_key}:${repeatedMerchant.count}`,
      type: 'developing_repeated_merchant',
      title: `${repeatedMerchant.merchant_name} is turning into a short-term pattern`,
      body: `${repeatedMerchant.merchant_name} has appeared ${repeatedMerchant.count} times in the last ${rollingActivity.days} days, which makes it one of the clearest near-term habits to review.`,
      severity: Number(repeatedMerchant.count || 0) >= USAGE_INSIGHT_THRESHOLDS.developingRepeatedMerchant.mediumCount ? 'medium' : 'low',
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

function tierGateSummary({ projection, rollingActivity, budgetLimit = null }) {
  const overall = projection?.overall || {};
  const currentActivity = projection?.current_activity || {};
  const historicalPeriodCount = Number(overall.historical_period_count || 0);
  const expenseCount = Number(currentActivity.expense_count || 0);
  const totalSpend = Number(currentActivity.total_spend || overall.current_spend_to_date || 0);
  const rollingCurrent = rollingActivity?.current_window || {};
  const rollingExpenseCount = Number(rollingCurrent.expense_count || 0);
  const rollingActiveDays = Number(rollingCurrent.active_day_count || 0);

  return {
    history_stage: overall.history_stage || 'none',
    historical_period_count: historicalPeriodCount,
    budget_set: Number(budgetLimit || 0) > 0,
    current_activity: {
      expense_count: expenseCount,
      active_day_count: Number(currentActivity.active_day_count || 0),
      total_spend: totalSpend,
      top_category: currentActivity.top_categories?.[0] || null,
      top_merchant: currentActivity.top_merchants?.[0] || null,
      uncategorized_count: Number(currentActivity.uncategorized_count || 0),
    },
    rolling_activity: {
      window_days: Number(rollingActivity?.days || 7),
      current_expense_count: rollingExpenseCount,
      current_active_day_count: rollingActiveDays,
      current_total_spend: Number(rollingCurrent.total_spend || 0),
      previous_total_spend: Number(rollingActivity?.previous_window?.total_spend || 0),
    },
    gates: {
      early: {
        eligible: historicalPeriodCount < 3 && expenseCount > 0 && totalSpend > 0,
        blocked_by: [
          historicalPeriodCount >= 3 ? 'mature_history_available' : null,
          expenseCount <= 0 ? 'no_current_expenses' : null,
          totalSpend <= 0 ? 'no_current_spend' : null,
        ].filter(Boolean),
      },
      developing: {
        eligible: historicalPeriodCount < 3
          && rollingExpenseCount >= USAGE_INSIGHT_THRESHOLDS.developing.minExpenseCount
          && rollingActiveDays >= USAGE_INSIGHT_THRESHOLDS.developing.minActiveDayCount
          && Number(rollingCurrent.total_spend || 0) > 0,
        blocked_by: [
          historicalPeriodCount >= 3 ? 'mature_history_available' : null,
          rollingExpenseCount < USAGE_INSIGHT_THRESHOLDS.developing.minExpenseCount
            ? `rolling_expense_count_lt_${USAGE_INSIGHT_THRESHOLDS.developing.minExpenseCount}`
            : null,
          rollingActiveDays < USAGE_INSIGHT_THRESHOLDS.developing.minActiveDayCount
            ? `rolling_active_day_count_lt_${USAGE_INSIGHT_THRESHOLDS.developing.minActiveDayCount}`
            : null,
          Number(rollingCurrent.total_spend || 0) <= 0 ? 'no_rolling_spend' : null,
        ].filter(Boolean),
      },
      mature: {
        eligible: historicalPeriodCount >= 3,
        blocked_by: historicalPeriodCount >= 3 ? [] : ['historical_period_count_lt_3'],
      },
    },
  };
}

module.exports = {
  USAGE_INSIGHT_THRESHOLDS,
  buildEarlyUsageInsights,
  summarizeExpenseRows,
  analyzeRollingActivity,
  buildDevelopingUsageInsights,
  tierGateSummary,
};
