const PurchasePlan = require('../models/purchasePlan');
const ProductPriceObservation = require('../models/productPriceObservation');
const BudgetSetting = require('../models/budgetSetting');
const db = require('../db');
const { analyzeSpendProjection } = require('./spendProjectionAnalyzer');
const { householdExpenseVisibilitySql } = require('./expenseAccessPolicy');

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function observationComparisonPrice(observation = {}) {
  return Number(observation.observed_unit_price || observation.observed_price || 0);
}

function bestPriceObservation(observations = []) {
  return observations.reduce((best, current) => {
    if (!best) return current;
    return observationComparisonPrice(current) < observationComparisonPrice(best) ? current : best;
  }, null);
}

function buildPriceOptions(observations = [], { limit = 5 } = {}) {
  const offersByMerchant = new Map();
  observations.forEach((item) => {
    const merchantKey = `${item.merchant || 'Unknown seller'}`.trim().toLowerCase();
    const existing = offersByMerchant.get(merchantKey);
    const itemPrice = Number(item.observed_price || 0);
    if (!existing || (itemPrice > 0 && itemPrice < Number(existing.observed_price || 0))) {
      offersByMerchant.set(merchantKey, item);
    }
  });
  return [...offersByMerchant.values()]
    .filter((item) => Number(item.observed_price) > 0)
    .sort((left, right) => Number(left.observed_price) - Number(right.observed_price))
    .slice(0, Math.max(1, Number(limit) || 5))
    .map((item) => ({
      merchant: item.merchant,
      price: Number(item.observed_price),
      unit_price: item.observed_unit_price == null ? null : Number(item.observed_unit_price),
      url: item.url || null,
      observed_at: item.observed_at,
      source_type: item.source_type,
    }));
}

function activeReservedAllocations(allocations = []) {
  return allocations.filter((allocation) => ['reserved', 'spent'].includes(allocation.state));
}

function buildFundingRecommendation({
  amount,
  minimumBuffer = 0,
  projectedHeadroom = 0,
  reservedElsewhere = 0,
  recoveryMonths = 2,
  pools = [],
  allocations = [],
}) {
  const targetAmount = Math.max(0, money(amount));
  const activeAllocations = activeReservedAllocations(allocations);
  const alreadyReserved = Math.min(
    targetAmount,
    money(activeAllocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0))
  );
  let remaining = Math.max(0, money(targetAmount - alreadyReserved));
  const usableHeadroom = Math.max(
    0,
    money(Number(projectedHeadroom || 0) - Number(minimumBuffer || 0) - Number(reservedElsewhere || 0))
  );
  const ownHeadroomReserved = money(activeAllocations
    .filter((allocation) => allocation.source_type === 'current_headroom')
    .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0));
  const additionalHeadroom = Math.max(0, money(usableHeadroom - ownHeadroomReserved));
  const headroomSuggestion = Math.min(remaining, additionalHeadroom);
  remaining = money(remaining - headroomSuggestion);

  const breakdown = [];
  if (alreadyReserved > 0) {
    breakdown.push({ source_type: 'reserved', label: 'Already set aside', amount: alreadyReserved });
  }
  if (headroomSuggestion > 0) {
    breakdown.push({
      source_type: 'current_headroom',
      label: 'Current budget room',
      amount: headroomSuggestion,
      reservable: true,
    });
  }

  for (const pool of pools) {
    if (remaining <= 0) break;
    const available = Math.max(0, money(pool.usable_amount));
    const contribution = Math.min(remaining, available);
    if (contribution <= 0) continue;
    breakdown.push({
      source_type: 'funding_pool',
      pool_id: pool.id,
      label: pool.name,
      pool_type: pool.pool_type,
      amount: contribution,
      replenishment_required: Boolean(pool.replenishment_required),
      reservable: true,
    });
    remaining = money(remaining - contribution);
  }

  const fundedAmount = money(targetAmount - remaining);
  const normalizedRecoveryMonths = Math.max(1, Math.min(6, Number(recoveryMonths) || 2));
  const recoveryMonthly = remaining > 0 ? money(remaining / normalizedRecoveryMonths) : 0;
  if (remaining > 0) {
    const start = new Date();
    const recoverySchedule = Array.from({ length: normalizedRecoveryMonths }, (_, index) => {
      const month = new Date(start.getFullYear(), start.getMonth() + index + 1, 1);
      const amountForMonth = index === normalizedRecoveryMonths - 1
        ? money(remaining - (recoveryMonthly * (normalizedRecoveryMonths - 1)))
        : recoveryMonthly;
      return {
        month: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
        amount: Math.max(0, amountForMonth),
      };
    });
    breakdown.push({
      source_type: 'future_recovery',
      label: `Recover over ${normalizedRecoveryMonths} months`,
      amount: remaining,
      monthly_amount: recoveryMonthly,
      months: normalizedRecoveryMonths,
      schedule: recoverySchedule,
      reservable: false,
    });
  }

  const poolAmount = money(breakdown
    .filter((entry) => entry.source_type === 'funding_pool')
    .reduce((sum, entry) => sum + entry.amount, 0));
  let recommendedStrategy = 'funded_now';
  if (remaining > 0) {
    const manageableRecovery = recoveryMonthly <= Math.max(50, usableHeadroom * 0.25);
    recommendedStrategy = manageableRecovery ? 'rebalance_and_recover' : 'wait_and_save';
  } else if (poolAmount > 0) {
    recommendedStrategy = 'use_savings';
  }

  return {
    evaluated_amount: targetAmount,
    current_headroom: usableHeadroom,
    reserved_elsewhere: money(reservedElsewhere),
    available_pool_total: money(pools.reduce((sum, pool) => sum + Number(pool.usable_amount || 0), 0)),
    already_reserved: alreadyReserved,
    funded_amount: fundedAmount,
    funding_gap: remaining,
    funding_percent: targetAmount > 0 ? Math.min(100, Math.round((fundedAmount / targetAmount) * 100)) : 0,
    recovery_monthly: recoveryMonthly,
    recommended_strategy: recommendedStrategy,
    funding_breakdown: breakdown,
  };
}

function detectPlanMaterialChange(previous, current) {
  if (!previous) return 'initial';
  const previousGap = Number(previous.funding_gap || 0);
  const currentGap = Number(current.funding_gap || 0);
  const gapDelta = currentGap - previousGap;
  const previousPrice = Number(previous.observed_price || previous.evaluated_amount || 0);
  const currentPrice = Number(current.observed_price || current.evaluated_amount || 0);
  const priceDelta = currentPrice - previousPrice;
  const threshold = Math.max(20, Number(current.evaluated_amount || 0) * 0.05);
  if (gapDelta <= -threshold || priceDelta <= -threshold) return 'improved';
  if (gapDelta >= threshold || priceDelta >= threshold) return 'worsened';
  return 'unchanged';
}

function projectionHeadroom(projection) {
  const overall = projection?.overall || {};
  if (overall.projected_budget_delta != null) {
    return Math.max(0, money(-Number(overall.projected_budget_delta)));
  }
  if (overall.budget_limit != null) {
    return Math.max(0, money(Number(overall.budget_limit) - Number(overall.current_spend_to_date || 0)));
  }
  return 0;
}

async function loadBudgetReallocationOptions({ user, scope = 'personal', period }) {
  if (!period?.from || !period?.to) return [];
  const householdScope = scope === 'household' && user.household_id;
  const settings = householdScope
    ? await BudgetSetting.findByHousehold(user.household_id)
    : await BudgetSetting.findByUser(user.id);
  const categorySettings = settings.filter((setting) => setting.category_id != null);
  if (!categorySettings.length) return [];

  const spendResult = householdScope
    ? await db.query(
      `SELECT COALESCE(c.parent_id, e.category_id) AS category_id, SUM(e.amount) AS spent
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
         AND ${householdExpenseVisibilitySql(4)}
         AND e.status = 'confirmed' AND e.exclude_from_budget = FALSE
         AND e.date >= $2 AND e.date < $3
       GROUP BY COALESCE(c.parent_id, e.category_id)`,
      [user.household_id, period.from, period.to, user.id]
    )
    : await db.query(
      `SELECT COALESCE(c.parent_id, e.category_id) AS category_id, SUM(e.amount) AS spent
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = $1 AND e.status = 'confirmed' AND e.exclude_from_budget = FALSE
         AND e.date >= $2 AND e.date < $3
       GROUP BY COALESCE(c.parent_id, e.category_id)`,
      [user.id, period.from, period.to]
    );
  const spentByCategory = new Map(spendResult.rows.map((row) => [row.category_id, Number(row.spent || 0)]));
  const categoryIds = categorySettings.map((setting) => setting.category_id);
  const names = await db.query('SELECT id, name FROM categories WHERE id = ANY($1)', [categoryIds]);
  const nameById = new Map(names.rows.map((row) => [row.id, row.name]));

  return categorySettings
    .map((setting) => {
      const limit = Number(setting.monthly_limit || 0);
      const spent = spentByCategory.get(setting.category_id) || 0;
      return {
        category_id: setting.category_id,
        name: nameById.get(setting.category_id) || 'Budget category',
        limit: money(limit),
        spent: money(spent),
        remaining: money(Math.max(0, limit - spent)),
      };
    })
    .filter((item) => item.remaining > 0)
    .sort((left, right) => right.remaining - left.remaining)
    .slice(0, 4);
}

async function evaluatePurchasePlan({ user, plan, persist = true, context = {} }) {
  const [projection, pools, allocations, reservedElsewhere, previousSnapshot] = await Promise.all([
    context.projection || analyzeSpendProjection({ user, scope: plan.scope }),
    context.pools || PurchasePlan.listPools(user.id),
    PurchasePlan.listAllocations(plan.id),
    PurchasePlan.reservedHeadroomElsewhere(user.id, plan.id),
    PurchasePlan.latestSnapshot(plan.id),
  ]);

  const identity = {
    productId: plan.product_id || plan.offer_watch?.product_id || null,
    comparableKey: plan.comparable_key || plan.offer_watch?.comparable_key || null,
    offerWatchId: plan.offer_watch?.id || null,
    since: new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString(),
    userId: user.id,
  };
  const observations = identity.productId || identity.comparableKey || identity.offerWatchId
    ? await ProductPriceObservation.findRecentByIdentity({ ...identity, limit: 25 })
    : [];
  const observation = bestPriceObservation(observations);
  const priceOptions = buildPriceOptions(observations);
  const observedPrice = observation
    ? Number(observation.observed_price)
    : plan.offer_watch?.last_observed_price ?? null;
  const evaluatedAmount = observedPrice && observedPrice > 0
    ? observedPrice
    : Number(plan.estimated_amount);

  const recommendation = buildFundingRecommendation({
    amount: evaluatedAmount,
    minimumBuffer: plan.minimum_buffer,
    projectedHeadroom: projectionHeadroom(projection),
    reservedElsewhere,
    recoveryMonths: plan.recovery_months,
    pools,
    allocations,
  });
  const snapshotInput = {
    ...recommendation,
    observed_price: observedPrice,
    reserved_amount: recommendation.already_reserved,
    material_change: detectPlanMaterialChange(previousSnapshot, {
      ...recommendation,
      observed_price: observedPrice,
    }),
    metadata: {
      projection_month: projection?.month || null,
      projection_confidence: projection?.overall?.confidence || null,
      price_source: observation?.source_type || null,
      price_merchant: observation?.merchant || null,
      price_observed_at: observation?.observed_at || null,
      price_option_count: priceOptions.length,
    },
  };
  const snapshot = persist
    ? await PurchasePlan.createSnapshot(plan.id, snapshotInput)
    : snapshotInput;
  const history = persist ? await PurchasePlan.listSnapshots(plan.id) : [];
  const budgetOptions = context.budgetOptions || await loadBudgetReallocationOptions({
    user,
    scope: plan.scope,
    period: projection?.period,
  });

  return {
    plan,
    snapshot,
    allocations,
    pools,
    projection_context: {
      month: projection?.month || null,
      confidence: projection?.overall?.confidence || null,
      budget_limit: projection?.overall?.budget_limit ?? null,
      projected_spend: projection?.overall?.adjusted_projected_total ?? null,
    },
    price_context: observation ? {
      price: Number(observation.observed_price),
      merchant: observation.merchant,
      url: observation.url,
      observed_at: observation.observed_at,
      source_type: observation.source_type,
    } : null,
    price_options: priceOptions,
    history,
    budget_options: budgetOptions,
  };
}

async function refreshPurchasePlans({ user, plans = [] }) {
  if (!plans.length) return;
  const scopes = [...new Set(plans.map((plan) => plan.scope || 'personal'))];
  const poolsPromise = PurchasePlan.listPools(user.id);
  const projections = await Promise.all(scopes.map(async (scope) => [
    scope,
    await analyzeSpendProjection({ user, scope }),
  ]));
  const projectionByScope = new Map(projections);
  const budgetOptions = await Promise.all(scopes.map(async (scope) => [
    scope,
    await loadBudgetReallocationOptions({
      user,
      scope,
      period: projectionByScope.get(scope)?.period,
    }),
  ]));
  const budgetOptionsByScope = new Map(budgetOptions);
  const pools = await poolsPromise;
  await Promise.all(plans.map((plan) => evaluatePurchasePlan({
    user,
    plan,
    context: {
      projection: projectionByScope.get(plan.scope || 'personal'),
      budgetOptions: budgetOptionsByScope.get(plan.scope || 'personal'),
      pools,
    },
  })));
}

async function refreshPlansForPriceObservations({ user, observations = [] }) {
  const plans = new Map();
  for (const observation of observations) {
    const matches = await PurchasePlan.listActiveByIdentityForUser(user.id, {
      productId: observation.product_id || null,
      comparableKey: observation.comparable_key || null,
      offerWatchId: observation.offer_watch_id || null,
    });
    matches.forEach((plan) => plans.set(plan.id, plan));
  }
  for (const plan of plans.values()) {
    await evaluatePurchasePlan({ user, plan });
  }
  return plans.size;
}

module.exports = {
  buildFundingRecommendation,
  bestPriceObservation,
  buildPriceOptions,
  detectPlanMaterialChange,
  evaluatePurchasePlan,
  projectionHeadroom,
  loadBudgetReallocationOptions,
  refreshPurchasePlans,
  refreshPlansForPriceObservations,
};
