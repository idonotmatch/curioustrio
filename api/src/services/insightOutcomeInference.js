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

const INFERABLE_OUTCOME_TYPES = new Map([
  ['recurring_restock_window', { outcomeType: 'restocked_item', windowDays: 10 }],
  ['buy_soon_better_price', { outcomeType: 'bought_price_watched_item', windowDays: 10 }],
  ['projected_category_under_baseline', { outcomeType: 'used_category_headroom', windowDays: 10, minAmount: 12 }],
  ['projected_month_end_under_budget', { outcomeType: 'used_budget_headroom', windowDays: 10, minAmount: 30 }],
  ['early_cleanup', { outcomeType: 'categorized_expenses', windowDays: 3 }],
  ['early_budget_pace', { outcomeType: 'set_budget_after_early_read', windowDays: 7 }],
  ['developing_weekly_spend_change', { outcomeType: 'set_budget_after_developing_read', windowDays: 7 }],
]);

function inferableOutcomeConfig(insightType) {
  return INFERABLE_OUTCOME_TYPES.get(`${insightType || ''}`.trim()) || null;
}

function summarizeOutcomeWindows(events = [], now = new Date()) {
  if (!Array.isArray(events) || !events.length) return [];
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) return [];

  const byInsightId = new Map();
  for (const event of events) {
    const insightId = `${event?.insight_id || ''}`.trim();
    if (!insightId) continue;
    if (!byInsightId.has(insightId)) byInsightId.set(insightId, []);
    byInsightId.get(insightId).push(event);
  }

  const windows = [];

  for (const [insightId, insightEvents] of byInsightId.entries()) {
    const shownOrTapped = insightEvents
      .filter((event) => event.event_type === 'shown' || event.event_type === 'tapped')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    if (!shownOrTapped) continue;

    const insightType = `${shownOrTapped?.metadata?.insight_type || shownOrTapped?.metadata?.type || ''}`.trim()
      || insightId.split(':')[0];
    const config = inferableOutcomeConfig(insightType);
    if (!config) continue;

    const shownAtMs = new Date(shownOrTapped.created_at).getTime();
    if (Number.isNaN(shownAtMs)) continue;

    const resolvedBy = insightEvents.find((event) =>
      event.event_type === 'acted'
      || event.event_type === 'dismissed'
      || event.event_type === 'not_helpful'
    ) || null;

    const expiresAtMs = shownAtMs + (config.windowDays * 24 * 60 * 60 * 1000);
    const status = resolvedBy
      ? 'resolved'
      : nowMs > expiresAtMs
        ? 'expired_no_action'
        : 'pending';

    windows.push({
      insight_id: insightId,
      insight_type: insightType,
      source_event_type: shownOrTapped.event_type,
      shown_at: shownOrTapped.created_at,
      expires_at: new Date(expiresAtMs).toISOString(),
      outcome_type: config.outcomeType,
      window_days: config.windowDays,
      status,
      resolved_event_type: resolvedBy?.event_type || null,
      scope: shownOrTapped?.metadata?.scope || null,
      maturity: shownOrTapped?.metadata?.maturity || null,
      type: shownOrTapped?.metadata?.type || shownOrTapped?.metadata?.insight_type || insightType,
    });
  }

  return windows.sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at));
}

function parseGroupKeyFromInsight(event = {}) {
  const insightType = `${event?.metadata?.insight_type || event?.metadata?.type || ''}`.trim()
    || `${event?.insight_id || ''}`.trim().split(':')[0];
  const insightId = `${event?.insight_id || ''}`.trim();
  if (!insightId) return '';

  if (insightType === 'recurring_restock_window') {
    return insightId.match(/^recurring_restock_window:(.+):\d{4}-\d{2}$/)?.[1] || '';
  }

  if (insightType === 'buy_soon_better_price') {
    return insightId.match(/^buy_soon_better_price:(.+):[^:]+:\d{4}-\d{2}-\d{2}$/)?.[1] || '';
  }

  return '';
}

function parseProjectionContextFromInsight(event = {}) {
  const insightId = `${event?.insight_id || ''}`.trim();
  if (!insightId) return null;

  if (
    `${event?.metadata?.insight_type || event?.metadata?.type || ''}`.trim() === 'projected_category_under_baseline'
    || insightId.startsWith('projected_category_under:')
  ) {
    const match = insightId.match(/^projected_category_under:(personal|household):(\d{4}-\d{2}):(.+)$/);
    if (!match) return null;
    return { scope: match[1], month: match[2], categoryKey: match[3] };
  }

  if (
    `${event?.metadata?.insight_type || event?.metadata?.type || ''}`.trim() === 'projected_month_end_under_budget'
    || insightId.startsWith('projected_under_budget:')
  ) {
    const match = insightId.match(/^projected_under_budget:(personal|household):(\d{4}-\d{2})$/);
    if (!match) return null;
    return { scope: match[1], month: match[2], categoryKey: null };
  }

  return null;
}

async function findMatchingPurchase({ user, groupKey, shownAt, windowDays }) {
  if (!user?.id || !groupKey || !shownAt || !windowDays) return null;

  const params = [shownAt, windowDays];
  let identityClause = '';

  if (groupKey.startsWith('product:')) {
    params.push(groupKey.slice('product:'.length));
    identityClause = `ei.product_id = $${params.length}`;
  } else if (groupKey.startsWith('comparable:')) {
    params.push(groupKey.slice('comparable:'.length));
    identityClause = `ei.comparable_key = $${params.length}`;
  } else {
    return null;
  }

  let scopeClause = '';
  if (user.household_id) {
    params.push(user.household_id, user.id);
    scopeClause = `
      AND (
        (e.household_id = $${params.length - 1}
         OR e.user_id IN (SELECT id FROM users WHERE household_id = $${params.length - 1}))
        AND (e.is_private = FALSE OR e.user_id = $${params.length})
      )`;
  } else {
    params.push(user.id);
    scopeClause = `AND e.user_id = $${params.length}`;
  }

  const result = await queryBudgetRelevant(
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       ei.description
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     WHERE ${identityClause}
       AND e.status = 'confirmed'
       AND e.exclude_from_budget = FALSE
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.date ASC, e.created_at ASC
     LIMIT 1`,
    params,
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       ei.description
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     WHERE ${identityClause}
       AND e.status = 'confirmed'
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.date ASC, e.created_at ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

async function findCategorySpendAfterShown({ user, categoryKey, shownAt, windowDays, scope, minAmount = 0 }) {
  if (!user?.id || !categoryKey || !shownAt || !windowDays) return null;

  const params = [shownAt, windowDays, categoryKey, minAmount];
  let scopeClause = '';

  if (scope === 'household' && user.household_id) {
    params.push(user.household_id, user.id);
    scopeClause = `
      AND (
        (e.household_id = $${params.length - 1}
         OR e.user_id IN (SELECT id FROM users WHERE household_id = $${params.length - 1}))
        AND (e.is_private = FALSE OR e.user_id = $${params.length})
      )`;
  } else {
    params.push(user.id);
    scopeClause = `AND e.user_id = $${params.length}`;
  }

  const result = await queryBudgetRelevant(
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       e.amount
     FROM expenses e
     WHERE e.category_id = $3
       AND e.status = 'confirmed'
       AND e.exclude_from_budget = FALSE
       AND e.amount >= $4
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.date ASC, e.created_at ASC
     LIMIT 1`,
    params,
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       e.amount
     FROM expenses e
     WHERE e.category_id = $3
       AND e.status = 'confirmed'
       AND e.amount >= $4
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.date ASC, e.created_at ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

async function findMeaningfulSpendAfterShown({ user, shownAt, windowDays, scope, minAmount = 0 }) {
  if (!user?.id || !shownAt || !windowDays) return null;

  const params = [shownAt, windowDays, minAmount];
  let scopeClause = '';

  if (scope === 'household' && user.household_id) {
    params.push(user.household_id, user.id);
    scopeClause = `
      AND (
        (e.household_id = $${params.length - 1}
         OR e.user_id IN (SELECT id FROM users WHERE household_id = $${params.length - 1}))
        AND (e.is_private = FALSE OR e.user_id = $${params.length})
      )`;
  } else {
    params.push(user.id);
    scopeClause = `AND e.user_id = $${params.length}`;
  }

  const result = await queryBudgetRelevant(
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       e.amount
     FROM expenses e
     WHERE e.status = 'confirmed'
       AND e.exclude_from_budget = FALSE
       AND e.amount >= $3
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.amount DESC, e.date ASC, e.created_at ASC
     LIMIT 1`,
    params,
    `SELECT
       e.id AS expense_id,
       e.date,
       e.created_at,
       e.merchant,
       e.amount
     FROM expenses e
     WHERE e.status = 'confirmed'
       AND e.amount >= $3
       AND e.date >= $1::date
       AND e.date <= ($1::date + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.amount DESC, e.date ASC, e.created_at ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

async function findCategorizedExpenseAfterShown({ user, shownAt, windowDays, scope }) {
  if (!user?.id || !shownAt || !windowDays) return null;

  const params = [shownAt, windowDays];
  let scopeClause = '';

  if (scope === 'household' && user.household_id) {
    params.push(user.household_id, user.id);
    scopeClause = `
      AND (
        (e.household_id = $${params.length - 1}
         OR e.user_id IN (SELECT id FROM users WHERE household_id = $${params.length - 1}))
        AND (e.is_private = FALSE OR e.user_id = $${params.length})
      )`;
  } else {
    params.push(user.id);
    scopeClause = `AND e.user_id = $${params.length}`;
  }

  const result = await queryBudgetRelevant(
    `SELECT e.id AS expense_id, e.created_at, e.merchant, e.category_id
     FROM expenses e
     WHERE e.status = 'confirmed'
       AND e.exclude_from_budget = FALSE
       AND e.category_id IS NOT NULL
       AND e.created_at >= $1::timestamptz
       AND e.created_at <= ($1::timestamptz + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.created_at ASC
     LIMIT 1`,
    params,
    `SELECT e.id AS expense_id, e.created_at, e.merchant, e.category_id
     FROM expenses e
     WHERE e.status = 'confirmed'
       AND e.category_id IS NOT NULL
       AND e.created_at >= $1::timestamptz
       AND e.created_at <= ($1::timestamptz + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY e.created_at ASC
     LIMIT 1`
  );

  return result.rows[0] || null;
}

async function findBudgetSettingAfterShown({ user, shownAt, windowDays, scope }) {
  if (!user?.id || !shownAt || !windowDays) return null;

  const params = [shownAt, windowDays];
  let scopeClause = '';

  if (scope === 'household' && user.household_id) {
    params.push(user.household_id);
    scopeClause = `AND bs.household_id = $${params.length}`;
  } else {
    params.push(user.id);
    scopeClause = `AND bs.user_id = $${params.length}`;
  }

  const result = await db.query(
    `SELECT bs.category_id, bs.monthly_limit, bs.updated_at
     FROM budget_settings bs
     WHERE bs.updated_at >= $1::timestamptz
       AND bs.updated_at <= ($1::timestamptz + ($2::text || ' days')::interval)
       ${scopeClause}
     ORDER BY bs.updated_at ASC
     LIMIT 1`,
    params
  );

  return result.rows[0] || null;
}

async function inferOutcomeEventsForUser({ user, events = [] }) {
  if (!user?.id || !Array.isArray(events) || !events.length) return [];

  const byInsightId = new Map();
  for (const event of events) {
    const insightId = `${event?.insight_id || ''}`.trim();
    if (!insightId) continue;
    if (!byInsightId.has(insightId)) byInsightId.set(insightId, []);
    byInsightId.get(insightId).push(event);
  }

  const inferred = [];

  for (const [insightId, insightEvents] of byInsightId.entries()) {
    const shownOrTapped = insightEvents
      .filter((event) => event.event_type === 'shown' || event.event_type === 'tapped')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    if (!shownOrTapped) continue;

    const insightType = `${shownOrTapped?.metadata?.insight_type || shownOrTapped?.metadata?.type || ''}`.trim()
      || insightId.split(':')[0];
    const config = inferableOutcomeConfig(insightType);
    if (!config) continue;

    const alreadyResolved = insightEvents.some((event) =>
      event.event_type === 'acted'
      || event.event_type === 'dismissed'
      || event.event_type === 'not_helpful'
    );
    if (alreadyResolved) continue;

    let inferredEvent = null;

    if (insightType === 'recurring_restock_window' || insightType === 'buy_soon_better_price') {
      const groupKey = parseGroupKeyFromInsight(shownOrTapped);
      if (!groupKey) continue;

      const matchingPurchase = await findMatchingPurchase({
        user,
        groupKey,
        shownAt: shownOrTapped.created_at,
        windowDays: config.windowDays,
      });
      if (!matchingPurchase) continue;

      inferredEvent = {
        insight_id: insightId,
        event_type: 'acted',
        metadata: {
          insight_type: insightType,
          outcome_type: config.outcomeType,
          inferred: true,
          source_event_type: shownOrTapped.event_type,
          group_key: groupKey,
          matched_expense_id: matchingPurchase.expense_id,
          matched_merchant: matchingPurchase.merchant || null,
          matched_item_description: matchingPurchase.description || null,
        },
        created_at: matchingPurchase.created_at || matchingPurchase.date,
      };
    }

    if (insightType === 'projected_category_under_baseline') {
      const context = parseProjectionContextFromInsight(shownOrTapped);
      if (!context?.categoryKey) continue;

      const matchingExpense = await findCategorySpendAfterShown({
        user,
        categoryKey: context.categoryKey,
        shownAt: shownOrTapped.created_at,
        windowDays: config.windowDays,
        scope: context.scope,
        minAmount: config.minAmount,
      });
      if (!matchingExpense) continue;

      inferredEvent = {
        insight_id: insightId,
        event_type: 'acted',
        metadata: {
          insight_type: insightType,
          outcome_type: config.outcomeType,
          inferred: true,
          source_event_type: shownOrTapped.event_type,
          category_key: context.categoryKey,
          scope: context.scope,
          matched_expense_id: matchingExpense.expense_id,
          matched_merchant: matchingExpense.merchant || null,
          matched_amount: Number(matchingExpense.amount || 0),
        },
        created_at: matchingExpense.created_at || matchingExpense.date,
      };
    }

    if (insightType === 'projected_month_end_under_budget') {
      const context = parseProjectionContextFromInsight(shownOrTapped);
      if (!context?.scope) continue;

      const matchingExpense = await findMeaningfulSpendAfterShown({
        user,
        shownAt: shownOrTapped.created_at,
        windowDays: config.windowDays,
        scope: context.scope,
        minAmount: config.minAmount,
      });
      if (!matchingExpense) continue;

      inferredEvent = {
        insight_id: insightId,
        event_type: 'acted',
        metadata: {
          insight_type: insightType,
          outcome_type: config.outcomeType,
          inferred: true,
          source_event_type: shownOrTapped.event_type,
          scope: context.scope,
          matched_expense_id: matchingExpense.expense_id,
          matched_merchant: matchingExpense.merchant || null,
          matched_amount: Number(matchingExpense.amount || 0),
        },
        created_at: matchingExpense.created_at || matchingExpense.date,
      };
    }

    if (insightType === 'early_cleanup') {
      const scope = shownOrTapped?.metadata?.scope === 'household' ? 'household' : 'personal';
      const matchingExpense = await findCategorizedExpenseAfterShown({
        user,
        shownAt: shownOrTapped.created_at,
        windowDays: config.windowDays,
        scope,
      });
      if (!matchingExpense) continue;

      inferredEvent = {
        insight_id: insightId,
        event_type: 'acted',
        metadata: {
          insight_type: insightType,
          outcome_type: config.outcomeType,
          inferred: true,
          source_event_type: shownOrTapped.event_type,
          scope,
          matched_expense_id: matchingExpense.expense_id,
          matched_merchant: matchingExpense.merchant || null,
          matched_category_id: matchingExpense.category_id || null,
        },
        created_at: matchingExpense.created_at,
      };
    }

    if (insightType === 'early_budget_pace' || insightType === 'developing_weekly_spend_change') {
      const scope = shownOrTapped?.metadata?.scope === 'household' ? 'household' : 'personal';
      const matchingBudget = await findBudgetSettingAfterShown({
        user,
        shownAt: shownOrTapped.created_at,
        windowDays: config.windowDays,
        scope,
      });
      if (!matchingBudget) continue;

      inferredEvent = {
        insight_id: insightId,
        event_type: 'acted',
        metadata: {
          insight_type: insightType,
          outcome_type: config.outcomeType,
          inferred: true,
          source_event_type: shownOrTapped.event_type,
          scope,
          category_id: matchingBudget.category_id || null,
          monthly_limit: Number(matchingBudget.monthly_limit || 0),
        },
        created_at: matchingBudget.updated_at,
      };
    }

    if (inferredEvent) {
      inferred.push(inferredEvent);
    }
  }

  return inferred;
}

module.exports = {
  inferableOutcomeConfig,
  summarizeOutcomeWindows,
  parseGroupKeyFromInsight,
  parseProjectionContextFromInsight,
  findCategorizedExpenseAfterShown,
  findBudgetSettingAfterShown,
  inferOutcomeEventsForUser,
};
