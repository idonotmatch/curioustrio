const db = require('../db');
const Expense = require('../models/expense');
const Household = require('../models/household');
const ScenarioMemory = require('../models/scenarioMemory');
const { decoratePlansWithTimingPreference } = require('./scenarioMemoryService');
const { householdExpenseVisibilitySql } = require('./expenseAccessPolicy');

const SUMMARY_EXPENSE_LIMIT = 12;

function periodBounds(month, startDay = 1) {
  const [year, mon] = `${month}`.split('-').map(Number);
  const pad = (value) => String(value).padStart(2, '0');
  const fromDate = new Date(year, mon - 1, startDay);
  const toDate = new Date(year, mon, startDay);
  return {
    from: `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`,
    to: `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`,
  };
}

function budgetPayload(row, from, to) {
  const limit = row?.limit == null ? 0 : Number(row.limit);
  const spent = Number(row?.spent || 0);
  return {
    total: limit > 0 ? { limit, spent, remaining: limit - spent } : null,
    categories: [],
    by_parent: [],
    period: { from, to },
  };
}

async function personalBudgetTotal(userId, from, to) {
  const result = await db.query(
    `SELECT
       (SELECT monthly_limit
        FROM budget_settings
        WHERE user_id = $1 AND category_id IS NULL
        LIMIT 1) AS limit,
       COALESCE(SUM(amount) FILTER (
         WHERE status = 'confirmed'
           AND exclude_from_budget = FALSE
           AND date >= $2 AND date < $3
       ), 0) AS spent
     FROM expenses
     WHERE user_id = $1
       AND status = 'confirmed'
       AND exclude_from_budget = FALSE
       AND date >= $2 AND date < $3`,
    [userId, from, to]
  );
  return budgetPayload(result.rows[0], from, to);
}

async function householdBudgetTotal(householdId, requesterUserId, from, to) {
  if (!householdId) return null;
  const result = await db.query(
    `SELECT
       (SELECT SUM(bs.monthly_limit)
        FROM budget_settings bs
        JOIN users u ON u.id = bs.user_id
        WHERE u.household_id = $1 AND bs.category_id IS NULL) AS limit,
       COALESCE(SUM(e.amount) FILTER (
         WHERE e.status = 'confirmed'
           AND e.exclude_from_budget = FALSE
           AND e.date >= $2 AND e.date < $3
       ), 0) AS spent
     FROM expenses e
     WHERE (e.household_id = $1
        OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
       AND ${householdExpenseVisibilitySql(4)}`,
    [householdId, from, to, requesterUserId]
  );
  return budgetPayload(result.rows[0], from, to);
}

async function householdContext(user) {
  if (!user?.household_id) return { household: null, member_count: 0 };
  const [household, countResult] = await Promise.all([
    Household.findById(user.household_id),
    db.query('SELECT COUNT(*)::int AS count FROM users WHERE household_id = $1', [user.household_id]),
  ]);
  return {
    household,
    member_count: Number(countResult.rows[0]?.count || 0),
  };
}

async function watchedPlans(userId) {
  try {
    const items = await ScenarioMemory.listWatchedByUser(userId, { limit: 5 });
    return decoratePlansWithTimingPreference(userId, items);
  } catch (err) {
    if (err?.code === '42P01' || /scenario_memory/i.test(`${err?.message || ''}`)) return [];
    throw err;
  }
}

async function buildSummaryBundle({ user, period, startDay }) {
  const { from, to } = periodBounds(period, startDay);
  const [context, personalBudget, expenses, householdBudget, householdExpenses, plans] = await Promise.all([
    householdContext(user),
    personalBudgetTotal(user.id, from, to),
    Expense.findByUser(user.id, { month: period, startDay, limit: SUMMARY_EXPENSE_LIMIT }),
    householdBudgetTotal(user.household_id, user.id, from, to),
    user.household_id
      ? Expense.findByHousehold(user.household_id, {
        userId: user.id,
        month: period,
        startDay,
        limit: SUMMARY_EXPENSE_LIMIT,
      })
      : Promise.resolve([]),
    watchedPlans(user.id),
  ]);

  return {
    period,
    start_day: startDay,
    generated_at: new Date().toISOString(),
    household: context.household,
    member_count: context.member_count,
    personal_budget: personalBudget,
    household_budget: householdBudget,
    expenses,
    household_expenses: householdExpenses,
    watched_plans: plans,
  };
}

module.exports = {
  SUMMARY_EXPENSE_LIMIT,
  buildSummaryBundle,
  periodBounds,
};
