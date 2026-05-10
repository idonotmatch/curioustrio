const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');

const DOMAINS = Object.freeze({
  expenses: 'expenses',
  householdExpenses: 'householdExpenses',
  budget: 'budget',
  pendingExpenses: 'pendingExpenses',
  insights: 'insights',
  forecastMovement: 'forecastMovement',
  gmailImport: 'gmailImport',
  household: 'household',
  categories: 'categories',
  recurring: 'recurring',
  watchedPlans: 'watchedPlans',
});

const EXPENSE_DOMAINS = [
  DOMAINS.expenses,
  DOMAINS.householdExpenses,
  DOMAINS.budget,
  DOMAINS.insights,
  DOMAINS.forecastMovement,
];

function eventScopeForUser(user, { privateOnly = false } = {}) {
  return {
    householdId: privateOnly ? null : (user?.household_id || null),
    userId: user?.id || null,
    targetUserId: privateOnly || !user?.household_id ? user?.id || null : null,
  };
}

async function emitFreshnessEvent(user, {
  eventType,
  domains,
  entityType = null,
  entityId = null,
  metadata = {},
  privateOnly = false,
  targetUserId = null,
} = {}) {
  const scope = eventScopeForUser(user, { privateOnly });
  try {
    return await HouseholdFreshnessEvent.create({
      ...scope,
      targetUserId: targetUserId || scope.targetUserId,
      eventType,
      domains,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    console.error('[freshness event] emit failed', {
      event_type: eventType || null,
      user_id: user?.id || null,
      household_id: user?.household_id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
    return null;
  }
}

async function emitExpenseFreshnessEvent(user, expense = {}, {
  eventType = 'expense_changed',
  includePending = false,
  includeGmail = false,
  metadata = {},
} = {}) {
  const privateOnly = expense?.is_private === true || expense?.is_private === 'true';
  const domains = [...EXPENSE_DOMAINS];
  if (includePending) domains.push(DOMAINS.pendingExpenses);
  if (includeGmail) domains.push(DOMAINS.gmailImport);
  return emitFreshnessEvent(user, {
    eventType,
    domains,
    entityType: 'expense',
    entityId: expense?.id || null,
    metadata,
    privateOnly,
  });
}

async function emitBudgetFreshnessEvent(user, eventType = 'budget_changed', metadata = {}) {
  return emitFreshnessEvent(user, {
    eventType,
    domains: [DOMAINS.budget, DOMAINS.insights, DOMAINS.forecastMovement],
    entityType: 'budget',
    metadata,
    privateOnly: !user?.household_id,
  });
}

async function emitHouseholdFreshnessEvent(user, eventType = 'household_changed', metadata = {}) {
  return emitFreshnessEvent(user, {
    eventType,
    domains: [
      DOMAINS.household,
      DOMAINS.householdExpenses,
      DOMAINS.budget,
      DOMAINS.insights,
      DOMAINS.forecastMovement,
    ],
    entityType: 'household',
    entityId: user?.household_id || null,
    metadata,
  });
}

async function emitCategoryFreshnessEvent(user, eventType = 'categories_changed', metadata = {}) {
  return emitFreshnessEvent(user, {
    eventType,
    domains: [
      DOMAINS.categories,
      DOMAINS.expenses,
      DOMAINS.householdExpenses,
      DOMAINS.budget,
      DOMAINS.insights,
      DOMAINS.forecastMovement,
    ],
    entityType: 'category',
    metadata,
  });
}

async function emitRecurringFreshnessEvent(user, eventType = 'recurring_changed', metadata = {}) {
  return emitFreshnessEvent(user, {
    eventType,
    domains: [DOMAINS.recurring, DOMAINS.insights],
    entityType: 'recurring',
    metadata,
  });
}

async function emitWatchedPlanFreshnessEvent(user, eventType = 'watched_plan_changed', metadata = {}) {
  return emitFreshnessEvent(user, {
    eventType,
    domains: [DOMAINS.watchedPlans],
    entityType: 'scenario_memory',
    metadata,
    privateOnly: true,
  });
}

module.exports = {
  DOMAINS,
  emitFreshnessEvent,
  emitExpenseFreshnessEvent,
  emitBudgetFreshnessEvent,
  emitHouseholdFreshnessEvent,
  emitCategoryFreshnessEvent,
  emitRecurringFreshnessEvent,
  emitWatchedPlanFreshnessEvent,
};
