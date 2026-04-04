const db = require('../db');
const BudgetSetting = require('../models/budgetSetting');
const Household = require('../models/household');

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

function currentPeriod(startDay = 1) {
  const now = new Date();
  if (now.getDate() >= startDay) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12, 0, 0, 0);
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

async function sumSpend({ scope, householdId, userId, from, toExclusive }) {
  if (scope === 'household') {
    const result = await db.query(
      `SELECT COALESCE(SUM(e.amount), 0) AS spent
       FROM expenses e
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND e.status = 'confirmed'
         AND e.date >= $2
         AND e.date < $3`,
      [householdId, from, toExclusive]
    );
    return Number(result.rows[0]?.spent || 0);
  }

  const result = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS spent
     FROM expenses
     WHERE user_id = $1
       AND status = 'confirmed'
       AND date >= $2
       AND date < $3`,
    [userId, from, toExclusive]
  );
  return Number(result.rows[0]?.spent || 0);
}

async function categorySpendByPeriod({ scope, householdId, userId, from, toExclusive }) {
  if (scope === 'household') {
    const result = await db.query(
      `SELECT
         COALESCE(pc.name || ' · ' || c.name, c.name, 'Uncategorized') AS category_name,
         COALESCE(e.category_id::text, 'uncategorized') AS category_key,
         COALESCE(SUM(e.amount), 0) AS spent
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       LEFT JOIN categories pc ON c.parent_id = pc.id
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND e.status = 'confirmed'
         AND e.date >= $2
         AND e.date < $3
       GROUP BY category_key, category_name`,
      [householdId, from, toExclusive]
    );
    return result.rows.map((row) => ({
      category_key: row.category_key,
      category_name: row.category_name,
      spent: Number(row.spent || 0),
    }));
  }

  const result = await db.query(
    `SELECT
       COALESCE(pc.name || ' · ' || c.name, c.name, 'Uncategorized') AS category_name,
       COALESCE(e.category_id::text, 'uncategorized') AS category_key,
       COALESCE(SUM(e.amount), 0) AS spent
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     LEFT JOIN categories pc ON c.parent_id = pc.id
     WHERE e.user_id = $1
       AND e.status = 'confirmed'
       AND e.date >= $2
       AND e.date < $3
     GROUP BY category_key, category_name`,
    [userId, from, toExclusive]
  );
  return result.rows.map((row) => ({
    category_key: row.category_key,
    category_name: row.category_name,
    spent: Number(row.spent || 0),
  }));
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

async function analyzeSpendingTrend({ user, scope = 'personal', month = null }) {
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
  const now = new Date();
  const currentKey = currentPeriod(startDay);
  const isCurrentPeriod = targetMonth === currentKey;
  const todayWithin = isCurrentPeriod
    ? new Date(Math.min(now.getTime(), addDays(bounds.toDate, -1).getTime()))
    : addDays(bounds.toDate, -1);
  todayWithin.setHours(12, 0, 0, 0);

  const totalDays = diffDays(bounds.fromDate, bounds.toDate);
  const elapsedDays = Math.max(1, diffDays(bounds.fromDate, addDays(todayWithin, 1)));
  const currentSpendToDate = await sumSpend({
    scope: effectiveScope,
    householdId: user.household_id,
    userId: user.id,
    from: bounds.from,
    toExclusive: dateOnly(addDays(bounds.fromDate, elapsedDays)),
  });

  const historicalPeriods = [];
  if (firstConfirmedExpenseAt) {
    for (let i = 1; i <= 3; i++) {
      const historicalMonth = shiftPeriod(targetMonth, -i);
      const historicalBounds = periodBounds(historicalMonth, startDay);
      if (historicalBounds.fromDate < firstConfirmedExpenseAt) continue;
      const historicalElapsedDays = Math.min(elapsedDays, diffDays(historicalBounds.fromDate, historicalBounds.toDate));
      const spentToDate = await sumSpend({
        scope: effectiveScope,
        householdId: user.household_id,
        userId: user.id,
        from: historicalBounds.from,
        toExclusive: dateOnly(addDays(historicalBounds.fromDate, historicalElapsedDays)),
      });
      const fullSpend = await sumSpend({
        scope: effectiveScope,
        householdId: user.household_id,
        userId: user.id,
        from: historicalBounds.from,
        toExclusive: historicalBounds.to,
      });
      historicalPeriods.push({
        month: historicalMonth,
        spent_to_date: spentToDate,
        total_spent: fullSpend,
      });
    }
  }

  const historicalSpendToDateAvg = historicalPeriods.length
    ? Number((historicalPeriods.reduce((sum, period) => sum + period.spent_to_date, 0) / historicalPeriods.length).toFixed(2))
    : null;
  const elapsedRatio = ratio(elapsedDays, totalDays);
  const projectedPeriodTotal = elapsedRatio
    ? Number((currentSpendToDate / elapsedRatio).toFixed(2))
    : currentSpendToDate;
  const deltaAmount = historicalSpendToDateAvg != null
    ? Number((currentSpendToDate - historicalSpendToDateAvg).toFixed(2))
    : null;
  const deltaPercent = historicalSpendToDateAvg && historicalSpendToDateAvg > 0
    ? Number((((currentSpendToDate - historicalSpendToDateAvg) / historicalSpendToDateAvg) * 100).toFixed(1))
    : null;

  let topDrivers = [];
  if (historicalPeriods.length) {
    const currentCategoryRows = await categorySpendByPeriod({
      scope: effectiveScope,
      householdId: user.household_id,
      userId: user.id,
      from: bounds.from,
      toExclusive: dateOnly(addDays(bounds.fromDate, elapsedDays)),
    });
    const currentCategoryMap = new Map(currentCategoryRows.map((row) => [row.category_key, row]));
    const historicalCategoryTotals = new Map();

    for (const period of historicalPeriods) {
      const historicalBounds = periodBounds(period.month, startDay);
      const historicalElapsedDays = Math.min(elapsedDays, diffDays(historicalBounds.fromDate, historicalBounds.toDate));
      const rows = await categorySpendByPeriod({
        scope: effectiveScope,
        householdId: user.household_id,
        userId: user.id,
        from: historicalBounds.from,
        toExclusive: dateOnly(addDays(historicalBounds.fromDate, historicalElapsedDays)),
      });
      for (const row of rows) {
        const existing = historicalCategoryTotals.get(row.category_key) || {
          category_key: row.category_key,
          category_name: row.category_name,
          spent: 0,
        };
        existing.spent += row.spent;
        historicalCategoryTotals.set(row.category_key, existing);
      }
    }

    const allCategoryKeys = new Set([
      ...currentCategoryMap.keys(),
      ...historicalCategoryTotals.keys(),
    ]);

    topDrivers = [...allCategoryKeys]
      .map((categoryKey) => {
        const current = currentCategoryMap.get(categoryKey);
        const historical = historicalCategoryTotals.get(categoryKey);
        const currentSpent = Number(current?.spent || 0);
        const historicalAvg = Number(((historical?.spent || 0) / historicalPeriods.length).toFixed(2));
        const driverDelta = Number((currentSpent - historicalAvg).toFixed(2));
        const driverDeltaPercent = historicalAvg > 0
          ? Number(((driverDelta / historicalAvg) * 100).toFixed(1))
          : null;
        return {
          category_key: categoryKey,
          category_name: current?.category_name || historical?.category_name || 'Uncategorized',
          current_spend_to_date: currentSpent,
          historical_spend_to_date_avg: historicalAvg,
          delta_amount: driverDelta,
          delta_percent: driverDeltaPercent,
        };
      })
      .filter((driver) => Math.abs(driver.delta_amount) >= 20)
      .sort((a, b) => Math.abs(b.delta_amount) - Math.abs(a.delta_amount))
      .slice(0, 3);
  }

  const budgetLimit = await getTotalBudgetLimit({
    scope: effectiveScope,
    householdId: user.household_id,
    userId: user.id,
  });

  const adherencePeriods = [];
  if (firstConfirmedExpenseAt) {
    for (let i = 1; i <= 6; i++) {
      const priorMonth = shiftPeriod(targetMonth, -i);
      const priorBounds = periodBounds(priorMonth, startDay);
      if (priorBounds.fromDate < firstConfirmedExpenseAt) continue;
      const actualSpend = await sumSpend({
        scope: effectiveScope,
        householdId: user.household_id,
        userId: user.id,
        from: priorBounds.from,
        toExclusive: priorBounds.to,
      });
      adherencePeriods.push({ month: priorMonth, actual_spend: actualSpend });
    }
  }

  const averageActualSpend = adherencePeriods.length
    ? Number((adherencePeriods.reduce((sum, period) => sum + period.actual_spend, 0) / adherencePeriods.length).toFixed(2))
    : null;
  const overBudgetPeriods = budgetLimit != null
    ? adherencePeriods.filter((period) => period.actual_spend > budgetLimit).length
    : null;
  const underBudgetPeriods = budgetLimit != null
    ? adherencePeriods.filter((period) => period.actual_spend < budgetLimit).length
    : null;

  let budgetFit = null;
  if (budgetLimit != null && averageActualSpend != null && adherencePeriods.length >= 4) {
    if (overBudgetPeriods >= 4) budgetFit = 'too_low';
    else if (underBudgetPeriods >= 5 && averageActualSpend <= budgetLimit * 0.85) budgetFit = 'too_high';
    else budgetFit = 'on_track';
  }

  return {
    scope: effectiveScope,
    month: targetMonth,
    period: {
      from: bounds.from,
      to: bounds.to,
      elapsed_days: elapsedDays,
      total_days: totalDays,
      elapsed_ratio: Number((elapsedRatio || 0).toFixed(4)),
      is_current_period: isCurrentPeriod,
      data_start_date: firstConfirmedExpenseDate,
    },
    pace: {
      current_spend_to_date: currentSpendToDate,
      historical_spend_to_date_avg: historicalSpendToDateAvg,
      delta_amount: deltaAmount,
      delta_percent: deltaPercent,
      projected_period_total: projectedPeriodTotal,
      historical_period_count: historicalPeriods.length,
      top_drivers: topDrivers,
      historical_periods: historicalPeriods,
    },
    budget_adherence: {
      budget_limit: budgetLimit,
      projected_over_under: budgetLimit != null ? Number((projectedPeriodTotal - budgetLimit).toFixed(2)) : null,
      average_actual_spend_last_6: averageActualSpend,
      over_budget_periods_last_6: overBudgetPeriods,
      under_budget_periods_last_6: underBudgetPeriods,
      budget_fit: budgetFit,
      historical_period_count: adherencePeriods.length,
      historical_periods: adherencePeriods,
    },
  };
}

module.exports = {
  analyzeSpendingTrend,
  periodBounds,
  currentPeriod,
  shiftPeriod,
};
