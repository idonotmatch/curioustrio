const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const PurchasePlan = require('../models/purchasePlan');
const { evaluatePurchasePlan, refreshPurchasePlans } = require('../services/purchasePlanningService');
const { emitWatchedPlanFreshnessEvent } = require('../services/freshnessEvents');
const { normalizeItemMetadata } = require('../services/itemNormalizer');

router.use(authenticate);

async function requireUser(req, res) {
  const user = await User.findByProviderUid(req.userId);
  if (!user) res.status(401).json({ error: 'User not synced' });
  return user;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validDateOrNull(value) {
  if (value == null || value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(`${value}`);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? `${value}`
    : undefined;
}

function validHttpUrlOrNull(value) {
  if (value == null || `${value}`.trim() === '') return null;
  try {
    const parsed = new URL(`${value}`.trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function offerWatchInput(body = {}, plan = {}) {
  const existingWatch = plan.offer_watch || {};
  const productName = `${body.product_name || body.metadata?.product_name || existingWatch.metadata?.product_name || ''}`.trim();
  const variantDescription = `${body.variant_description || body.variant?.description || existingWatch.variant?.description || ''}`.trim();
  const derivedIdentity = productName
    ? normalizeItemMetadata({ description: [productName, variantDescription].filter(Boolean).join(' ') })
    : null;
  return {
    productId: body.product_id || existingWatch.product_id || plan.product_id || plan.productId || null,
    comparableKey: body.comparable_key || derivedIdentity?.comparable_key || existingWatch.comparable_key || plan.comparable_key || plan.comparableKey || null,
    merchant: body.merchant === undefined ? existingWatch.merchant : body.merchant,
    retailerProductKey: body.retailer_product_key === undefined ? existingWatch.retailer_product_key : body.retailer_product_key,
    url: body.url || (body.enabled === false ? existingWatch.url : body.url),
    variant: {
      ...(existingWatch.variant || {}),
      ...(body.variant || {}),
      ...(variantDescription ? { description: variantDescription } : {}),
    },
    targetPrice: body.target_price === undefined ? existingWatch.target_price : body.target_price,
    enabled: body.enabled,
    sourcePreference: body.source_preference || existingWatch.source_preference || 'best_available',
    metadata: {
      ...(existingWatch.metadata || {}),
      ...(body.metadata || {}),
      ...(productName ? { product_name: productName } : {}),
      reference_url_only: false,
    },
  };
}

function planInput(body = {}) {
  return {
    label: `${body.label || ''}`.trim(),
    estimatedAmount: positiveNumber(body.estimated_amount),
    amountMin: body.amount_min == null ? null : positiveNumber(body.amount_min),
    amountMax: body.amount_max == null ? null : positiveNumber(body.amount_max),
    priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal',
    desiredBy: body.desired_by || null,
    recoveryMonths: Math.max(1, Math.min(6, Number(body.recovery_months) || 2)),
    minimumBuffer: Math.max(0, Number(body.minimum_buffer) || 0),
    productId: body.product_id || null,
    comparableKey: body.comparable_key || null,
    notes: `${body.notes || ''}`.trim() || null,
  };
}

router.get('/funding-pools', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ items: await PurchasePlan.listPools(user.id) });
  } catch (error) { next(error); }
});

router.post('/funding-pools', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const name = `${req.body.name || ''}`.trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const availableAmount = Number(req.body.available_amount || 0);
    const protectedAmount = Number(req.body.protected_amount || 0);
    if (availableAmount < 0 || protectedAmount < 0 || protectedAmount > availableAmount) {
      return res.status(400).json({ error: 'Funding amounts are invalid' });
    }
    const pool = await PurchasePlan.upsertPool(user.id, {
      id: req.body.id || null,
      householdId: req.body.scope === 'household' ? user.household_id : null,
      name,
      poolType: ['savings', 'budget_pool', 'general_reserve', 'other'].includes(req.body.pool_type)
        ? req.body.pool_type : 'savings',
      availableAmount,
      protectedAmount,
      replenishmentRequired: Boolean(req.body.replenishment_required),
      replenishBy: req.body.replenish_by || null,
      active: req.body.active,
      sortOrder: Number(req.body.sort_order || 0),
    });
    if (!pool) return res.status(404).json({ error: 'Funding source not found' });
    await emitWatchedPlanFreshnessEvent(user, 'planning_funding_source_updated', { funding_pool_id: pool.id });
    res.status(req.body.id ? 200 : 201).json({ pool });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    let items = await PurchasePlan.listByUser(user.id, { includeResolved: req.query.history === '1' });
    if (req.query.refresh === '1') {
      await refreshPurchasePlans({
        user,
        plans: items.filter((item) => ['considering', 'ready', 'deferred'].includes(item.state)).slice(0, 8),
      });
      items = await PurchasePlan.listByUser(user.id, { includeResolved: req.query.history === '1' });
    }
    res.json({ items });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const input = planInput(req.body);
    if (!input.label) return res.status(400).json({ error: 'label is required' });
    if (!input.estimatedAmount) return res.status(400).json({ error: 'estimated_amount must be greater than 0' });
    const scope = req.body.scope === 'household' ? 'household' : 'personal';
    if (scope === 'household' && !user.household_id) {
      return res.status(403).json({ error: 'Must be in a household for household plans' });
    }
    let preparedProductWatch = null;
    if (req.body.product_watch) {
      preparedProductWatch = offerWatchInput(req.body.product_watch, input);
      const url = validHttpUrlOrNull(preparedProductWatch.url);
      if (url === undefined) return res.status(400).json({ error: 'Product URL must be a valid http or https address' });
      preparedProductWatch.url = url;
    }
    let plan = await PurchasePlan.create({
      userId: user.id,
      householdId: scope === 'household' ? user.household_id : null,
      scope,
      ...input,
    });
    if (preparedProductWatch) {
      await PurchasePlan.upsertOfferWatch(plan.id, preparedProductWatch);
      plan = await PurchasePlan.findByIdForUser(plan.id, user.id);
    }
    const evaluation = await evaluatePurchasePlan({ user, plan });
    await emitWatchedPlanFreshnessEvent(user, 'purchase_plan_created', { purchase_plan_id: plan.id });
    res.status(201).json(evaluation);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const [allocations, pools, history] = await Promise.all([
      PurchasePlan.listAllocations(plan.id),
      PurchasePlan.listPools(user.id),
      PurchasePlan.listSnapshots(plan.id),
    ]);
    res.json({ plan, snapshot: plan.latest_snapshot || null, allocations, pools, history });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const current = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!current) return res.status(404).json({ error: 'Plan not found' });
    const patch = {};
    if (req.body.label !== undefined) patch.label = `${req.body.label}`.trim();
    if (req.body.scope !== undefined) {
      patch.scope = req.body.scope === 'household' ? 'household' : 'personal';
      if (patch.scope === 'household' && !user.household_id) {
        return res.status(403).json({ error: 'Must be in a household for household plans' });
      }
      patch.householdId = patch.scope === 'household' ? user.household_id : null;
    }
    if (req.body.estimated_amount !== undefined) patch.estimatedAmount = positiveNumber(req.body.estimated_amount);
    if (req.body.amount_min !== undefined) patch.amountMin = req.body.amount_min == null ? null : positiveNumber(req.body.amount_min);
    if (req.body.amount_max !== undefined) patch.amountMax = req.body.amount_max == null ? null : positiveNumber(req.body.amount_max);
    if (['considering', 'ready', 'purchased', 'abandoned', 'deferred'].includes(req.body.state)) patch.state = req.body.state;
    if (['low', 'normal', 'high'].includes(req.body.priority)) patch.priority = req.body.priority;
    if (req.body.desired_by !== undefined) patch.desiredBy = req.body.desired_by || null;
    if (req.body.recovery_months !== undefined) patch.recoveryMonths = Math.max(1, Math.min(6, Number(req.body.recovery_months) || 2));
    if (req.body.minimum_buffer !== undefined) patch.minimumBuffer = Math.max(0, Number(req.body.minimum_buffer) || 0);
    if (req.body.notes !== undefined) patch.notes = `${req.body.notes || ''}`.trim() || null;
    if (req.body.purchase_expense_id !== undefined) patch.purchaseExpenseId = req.body.purchase_expense_id || null;
    if (req.body.selected_strategy !== undefined) {
      patch.selectedStrategy = ['current_budget', 'funding_sources', 'recover_over_time', 'wait'].includes(req.body.selected_strategy)
        ? req.body.selected_strategy : null;
    }
    if (req.body.decision_criteria !== undefined) {
      patch.decisionCriteria = req.body.decision_criteria && typeof req.body.decision_criteria === 'object'
        ? req.body.decision_criteria : {};
    }
    if (req.body.revisit_on !== undefined) {
      patch.revisitOn = validDateOrNull(req.body.revisit_on);
      if (patch.revisitOn === undefined) return res.status(400).json({ error: 'revisit_on must use YYYY-MM-DD' });
    }
    if (patch.label === '' || patch.estimatedAmount === null) return res.status(400).json({ error: 'Plan fields are invalid' });
    let preparedProductWatch = null;
    if (req.body.product_watch) {
      preparedProductWatch = offerWatchInput(req.body.product_watch, current);
      const url = validHttpUrlOrNull(preparedProductWatch.url);
      if (url === undefined) return res.status(400).json({ error: 'Product URL must be a valid http or https address' });
      preparedProductWatch.url = url;
    }
    let plan = await PurchasePlan.update(req.params.id, user.id, patch);
    if (patch.state) await PurchasePlan.transitionAllocations(plan.id, patch.state);
    if (preparedProductWatch) {
      await PurchasePlan.upsertOfferWatch(plan.id, preparedProductWatch);
      plan = await PurchasePlan.findByIdForUser(plan.id, user.id);
    }
    const evaluation = ['considering', 'ready', 'deferred'].includes(plan.state)
      ? await evaluatePurchasePlan({ user, plan })
      : { plan };
    await emitWatchedPlanFreshnessEvent(user, 'purchase_plan_updated', { purchase_plan_id: plan.id, state: plan.state });
    res.json(evaluation);
  } catch (error) { next(error); }
});

router.post('/:id/evaluate', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(await evaluatePurchasePlan({ user, plan }));
  } catch (error) { next(error); }
});

router.post('/:id/allocations', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const sourceType = req.body.source_type;
    const amount = positiveNumber(req.body.amount);
    if (!['current_headroom', 'funding_pool', 'future_recovery', 'installment'].includes(sourceType) || !amount) {
      return res.status(400).json({ error: 'source_type and a positive amount are required' });
    }
    const preview = await evaluatePurchasePlan({ user, plan, persist: false });
    const matchingSuggestion = (preview.snapshot.funding_breakdown || []).find((entry) => (
      entry.source_type === sourceType
      && (sourceType !== 'funding_pool' || entry.pool_id === req.body.pool_id)
    ));
    const remainingLimit = sourceType === 'future_recovery' || sourceType === 'installment'
      ? Number(preview.snapshot.funding_gap || 0)
      : Number(matchingSuggestion?.amount || 0);
    if (amount > remainingLimit + 0.001) {
      return res.status(400).json({ error: 'That amount is no longer available to reserve for this plan' });
    }
    if (sourceType === 'funding_pool') {
      const pool = (await PurchasePlan.listPools(user.id)).find((item) => item.id === req.body.pool_id);
      if (!pool || amount > pool.usable_amount) return res.status(400).json({ error: 'Funding pool does not have enough available' });
    }
    const allocation = await PurchasePlan.createAllocation(plan.id, {
      poolId: req.body.pool_id || null,
      sourceType,
      amount,
      state: req.body.state === 'suggested' ? 'suggested' : 'reserved',
      recoveryMonth: req.body.recovery_month || null,
      metadata: req.body.metadata || {},
    });
    const evaluation = await evaluatePurchasePlan({ user, plan });
    await emitWatchedPlanFreshnessEvent(user, 'purchase_plan_updated', { purchase_plan_id: plan.id, action: 'allocation_added' });
    res.status(201).json({ allocation, ...evaluation });
  } catch (error) { next(error); }
});

router.delete('/:id/allocations/:allocationId', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const allocation = await PurchasePlan.releaseAllocation(req.params.allocationId, plan.id);
    if (!allocation) return res.status(404).json({ error: 'Allocation not found' });
    const evaluation = await evaluatePurchasePlan({ user, plan });
    await emitWatchedPlanFreshnessEvent(user, 'purchase_plan_updated', { purchase_plan_id: plan.id, action: 'allocation_released' });
    res.json({ allocation, ...evaluation });
  } catch (error) { next(error); }
});

router.post('/:id/product-watch', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const plan = await PurchasePlan.findByIdForUser(req.params.id, user.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const watchInput = offerWatchInput(req.body, plan);
    const identityPresent = watchInput.productId || watchInput.comparableKey || watchInput.url;
    if (!identityPresent) return res.status(400).json({ error: 'An exact product name, product identity, or reference URL is required' });
    const url = validHttpUrlOrNull(watchInput.url);
    if (url === undefined) return res.status(400).json({ error: 'Product URL must be a valid http or https address' });
    const watch = await PurchasePlan.upsertOfferWatch(plan.id, { ...watchInput, url });
    res.json({ watch });
  } catch (error) { next(error); }
});

module.exports = router;
