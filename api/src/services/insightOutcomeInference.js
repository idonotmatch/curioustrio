const db = require('../db');

const INFERABLE_OUTCOME_TYPES = new Map([
  ['recurring_restock_window', { outcomeType: 'restocked_item', windowDays: 10 }],
  ['buy_soon_better_price', { outcomeType: 'bought_price_watched_item', windowDays: 10 }],
  ['projected_category_under_baseline', { outcomeType: 'used_category_headroom', windowDays: 10, minAmount: 12 }],
  ['projected_month_end_under_budget', { outcomeType: 'used_budget_headroom', windowDays: 10, minAmount: 30 }],
]);

function inferableOutcomeConfig(insightType) {
  return INFERABLE_OUTCOME_TYPES.get(`${insightType || ''}`.trim()) || null;
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

  const result = await db.query(
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
     LIMIT 1`,
    params
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

  const result = await db.query(
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
     LIMIT 1`,
    params
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

  const result = await db.query(
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

    if (inferredEvent) {
      inferred.push(inferredEvent);
    }
  }

  return inferred;
}

module.exports = {
  inferableOutcomeConfig,
  parseGroupKeyFromInsight,
  parseProjectionContextFromInsight,
  inferOutcomeEventsForUser,
};
