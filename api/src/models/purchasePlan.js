const db = require('../db');

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function normalizePlan(row) {
  if (!row) return null;
  const plan = {
    ...row,
    estimated_amount: Number(row.estimated_amount),
    amount_min: numberOrNull(row.amount_min),
    amount_max: numberOrNull(row.amount_max),
    minimum_buffer: Number(row.minimum_buffer || 0),
    recovery_months: Number(row.recovery_months || 2),
    decision_criteria: row.decision_criteria && typeof row.decision_criteria === 'object' ? row.decision_criteria : {},
  };
  if (row.latest_snapshot) plan.latest_snapshot = normalizeSnapshot(row.latest_snapshot);
  if (row.offer_watch) plan.offer_watch = normalizeOfferWatch(row.offer_watch);
  return plan;
}

function normalizePool(row) {
  if (!row) return null;
  return {
    ...row,
    available_amount: Number(row.available_amount || 0),
    protected_amount: Number(row.protected_amount || 0),
    sort_order: Number(row.sort_order || 0),
  };
}

function normalizeAllocation(row) {
  if (!row) return null;
  return { ...row, amount: Number(row.amount || 0) };
}

function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    ...row,
    evaluated_amount: Number(row.evaluated_amount || 0),
    observed_price: numberOrNull(row.observed_price),
    current_headroom: Number(row.current_headroom || 0),
    reserved_elsewhere: Number(row.reserved_elsewhere || 0),
    available_pool_total: Number(row.available_pool_total || 0),
    funded_amount: Number(row.funded_amount || 0),
    funding_gap: Number(row.funding_gap || 0),
    recovery_monthly: Number(row.recovery_monthly || 0),
    reserved_amount: Number(row.reserved_amount || 0),
  };
}

function normalizeOfferWatch(row) {
  if (!row) return null;
  return {
    ...row,
    target_price: numberOrNull(row.target_price),
    last_observed_price: numberOrNull(row.last_observed_price),
  };
}

async function listByUser(userId, { includeResolved = false } = {}) {
  const states = includeResolved
    ? `('considering','ready','deferred','purchased','abandoned')`
    : `('considering','ready','deferred')`;
  const result = await db.query(
    `SELECT p.*,
       CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END AS latest_snapshot,
       CASE WHEN w.id IS NULL THEN NULL ELSE to_jsonb(w) END AS offer_watch
     FROM purchase_plans p
     LEFT JOIN LATERAL (
       SELECT * FROM purchase_plan_snapshots
       WHERE plan_id = p.id ORDER BY created_at DESC LIMIT 1
     ) s ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM product_offer_watches
       WHERE plan_id = p.id AND enabled = TRUE ORDER BY updated_at DESC LIMIT 1
     ) w ON TRUE
     WHERE p.user_id = $1 AND p.state IN ${states}
     ORDER BY
       CASE p.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       p.updated_at DESC`,
    [userId]
  );
  return result.rows.map(normalizePlan);
}

async function findByIdForUser(id, userId) {
  const result = await db.query(
    `SELECT p.*,
       CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END AS latest_snapshot,
       CASE WHEN w.id IS NULL THEN NULL ELSE to_jsonb(w) END AS offer_watch
     FROM purchase_plans p
     LEFT JOIN LATERAL (
       SELECT * FROM purchase_plan_snapshots
       WHERE plan_id = p.id ORDER BY created_at DESC LIMIT 1
     ) s ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM product_offer_watches
       WHERE plan_id = p.id AND enabled = TRUE ORDER BY updated_at DESC LIMIT 1
     ) w ON TRUE
     WHERE p.id = $1 AND p.user_id = $2`,
    [id, userId]
  );
  return normalizePlan(result.rows[0]);
}

async function listActiveByIdentityForUser(userId, { productId = null, comparableKey = null, offerWatchId = null } = {}) {
  if (!productId && !comparableKey && !offerWatchId) return [];
  const result = await db.query(
    `SELECT DISTINCT p.*, CASE WHEN w.id IS NULL THEN NULL ELSE to_jsonb(w) END AS offer_watch
     FROM purchase_plans p
     LEFT JOIN product_offer_watches w ON w.plan_id = p.id AND w.enabled = TRUE
     WHERE p.user_id = $1
       AND p.state IN ('considering', 'ready', 'deferred')
       AND (
         ($2::uuid IS NOT NULL AND (p.product_id = $2 OR w.product_id = $2))
         OR ($3::text IS NOT NULL AND (p.comparable_key = $3 OR w.comparable_key = $3))
         OR ($4::uuid IS NOT NULL AND w.id = $4)
       )
     ORDER BY p.updated_at DESC
     LIMIT 10`,
    [userId, productId, comparableKey, offerWatchId]
  );
  return result.rows.map(normalizePlan);
}

async function create(input) {
  const result = await db.query(
    `INSERT INTO purchase_plans (
       user_id, household_id, scope, label, estimated_amount, amount_min, amount_max,
       priority, desired_by, recovery_months, minimum_buffer, product_id, comparable_key, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      input.userId, input.householdId || null, input.scope || 'personal', input.label,
      input.estimatedAmount, input.amountMin || null, input.amountMax || null,
      input.priority || 'normal', input.desiredBy || null, input.recoveryMonths || 2,
      input.minimumBuffer || 0, input.productId || null, input.comparableKey || null,
      input.notes || null,
    ]
  );
  return normalizePlan(result.rows[0]);
}

async function update(id, userId, patch) {
  const current = await findByIdForUser(id, userId);
  if (!current) return null;
  const value = (key, fallback) => patch[key] === undefined ? fallback : patch[key];
  const result = await db.query(
    `UPDATE purchase_plans SET
       scope = $3, household_id = $4, label = $5, estimated_amount = $6,
       amount_min = $7, amount_max = $8, state = $9, priority = $10,
       desired_by = $11, recovery_months = $12, minimum_buffer = $13,
       product_id = $14, comparable_key = $15, notes = $16,
       purchase_expense_id = $17, selected_strategy = $18,
       decision_criteria = $19, revisit_on = $20, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      id, userId,
      value('scope', current.scope), value('householdId', current.household_id),
      value('label', current.label), value('estimatedAmount', current.estimated_amount),
      value('amountMin', current.amount_min), value('amountMax', current.amount_max),
      value('state', current.state), value('priority', current.priority),
      value('desiredBy', current.desired_by), value('recoveryMonths', current.recovery_months),
      value('minimumBuffer', current.minimum_buffer), value('productId', current.product_id),
      value('comparableKey', current.comparable_key), value('notes', current.notes),
      value('purchaseExpenseId', current.purchase_expense_id),
      value('selectedStrategy', current.selected_strategy),
      value('decisionCriteria', current.decision_criteria || {}),
      value('revisitOn', current.revisit_on),
    ]
  );
  return normalizePlan(result.rows[0]);
}

async function listPools(userId) {
  const result = await db.query(
    `SELECT *, GREATEST(available_amount - protected_amount - COALESCE(reserved.reserved_amount, 0), 0) AS usable_amount
     FROM planning_funding_pools pools
     LEFT JOIN LATERAL (
       SELECT SUM(amount) AS reserved_amount
       FROM purchase_plan_allocations
       WHERE pool_id = pools.id AND state IN ('reserved', 'spent')
     ) reserved ON TRUE
     WHERE user_id = $1 AND active = TRUE
     ORDER BY sort_order, updated_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...normalizePool(row),
    reserved_amount: Number(row.reserved_amount || 0),
    usable_amount: Number(row.usable_amount || 0),
  }));
}

async function upsertPool(userId, input) {
  if (input.id) {
    const result = await db.query(
      `UPDATE planning_funding_pools SET
         name = COALESCE($3, name), pool_type = COALESCE($4, pool_type),
         available_amount = COALESCE($5, available_amount), protected_amount = COALESCE($6, protected_amount),
         replenishment_required = COALESCE($7, replenishment_required), replenish_by = $8,
         active = COALESCE($9, active), sort_order = COALESCE($10, sort_order), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [input.id, userId, input.name, input.poolType, input.availableAmount, input.protectedAmount,
        input.replenishmentRequired, input.replenishBy || null, input.active, input.sortOrder]
    );
    return normalizePool(result.rows[0]);
  }
  const result = await db.query(
    `INSERT INTO planning_funding_pools (
       user_id, household_id, name, pool_type, available_amount, protected_amount,
       replenishment_required, replenish_by, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, input.householdId || null, input.name, input.poolType || 'savings',
      input.availableAmount || 0, input.protectedAmount || 0, Boolean(input.replenishmentRequired),
      input.replenishBy || null, input.sortOrder || 0]
  );
  return normalizePool(result.rows[0]);
}

async function listAllocations(planId) {
  const result = await db.query(
    `SELECT a.*, p.name AS pool_name
     FROM purchase_plan_allocations a
     LEFT JOIN planning_funding_pools p ON p.id = a.pool_id
     WHERE a.plan_id = $1 AND a.state <> 'released'
     ORDER BY a.created_at`,
    [planId]
  );
  return result.rows.map(normalizeAllocation);
}

async function reservedHeadroomElsewhere(userId, planId) {
  const result = await db.query(
    `SELECT COALESCE(SUM(a.amount), 0) AS amount
     FROM purchase_plan_allocations a
     JOIN purchase_plans p ON p.id = a.plan_id
     WHERE p.user_id = $1 AND p.id <> $2
       AND p.state IN ('considering', 'ready', 'deferred')
       AND a.source_type = 'current_headroom' AND a.state IN ('reserved', 'spent')`,
    [userId, planId]
  );
  return Number(result.rows[0]?.amount || 0);
}

async function createAllocation(planId, input) {
  const result = await db.query(
    `INSERT INTO purchase_plan_allocations (
       plan_id, pool_id, source_type, amount, state, recovery_month, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [planId, input.poolId || null, input.sourceType, input.amount,
      input.state || 'reserved', input.recoveryMonth || null, input.metadata || {}]
  );
  return normalizeAllocation(result.rows[0]);
}

async function releaseAllocation(id, planId) {
  const result = await db.query(
    `UPDATE purchase_plan_allocations SET state = 'released', updated_at = NOW()
     WHERE id = $1 AND plan_id = $2 RETURNING *`,
    [id, planId]
  );
  return normalizeAllocation(result.rows[0]);
}

async function transitionAllocations(planId, state) {
  if (state === 'purchased') {
    await db.query(
      `UPDATE purchase_plan_allocations SET state = 'spent', updated_at = NOW()
       WHERE plan_id = $1 AND state = 'reserved'`,
      [planId]
    );
  } else if (state === 'abandoned') {
    await db.query(
      `UPDATE purchase_plan_allocations SET state = 'released', updated_at = NOW()
       WHERE plan_id = $1 AND state IN ('suggested', 'reserved')`,
      [planId]
    );
  }
}

async function latestSnapshot(planId) {
  const result = await db.query(
    `SELECT * FROM purchase_plan_snapshots WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [planId]
  );
  return normalizeSnapshot(result.rows[0]);
}

async function listSnapshots(planId, { limit = 12 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const result = await db.query(
    `SELECT * FROM purchase_plan_snapshots
     WHERE plan_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [planId, safeLimit]
  );
  return result.rows.map(normalizeSnapshot);
}

async function createSnapshot(planId, snapshot) {
  const result = await db.query(
    `INSERT INTO purchase_plan_snapshots (
       plan_id, evaluated_amount, observed_price, current_headroom, reserved_elsewhere,
       available_pool_total, funded_amount, funding_gap, recovery_monthly, reserved_amount,
       recommended_strategy, funding_breakdown, material_change, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [planId, snapshot.evaluated_amount, snapshot.observed_price, snapshot.current_headroom,
      snapshot.reserved_elsewhere, snapshot.available_pool_total, snapshot.funded_amount,
      snapshot.funding_gap, snapshot.recovery_monthly, snapshot.reserved_amount || 0,
      snapshot.recommended_strategy, snapshot.funding_breakdown, snapshot.material_change, snapshot.metadata || {}]
  );
  await db.query('UPDATE purchase_plans SET last_evaluated_at = NOW(), updated_at = NOW() WHERE id = $1', [planId]);
  return normalizeSnapshot(result.rows[0]);
}

async function upsertOfferWatch(planId, input) {
  const existing = await db.query(
    `SELECT id FROM product_offer_watches WHERE plan_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [planId]
  );
  if (existing.rows[0]) {
    const result = await db.query(
      `UPDATE product_offer_watches SET
         product_id = $3, comparable_key = $4, merchant = $5, retailer_product_key = $6,
         url = $7, variant = $8, target_price = $9, enabled = $10,
         source_preference = $11, metadata = $12, updated_at = NOW()
       WHERE id = $1 AND plan_id = $2 RETURNING *`,
      [existing.rows[0].id, planId, input.productId || null, input.comparableKey || null,
        input.merchant || null, input.retailerProductKey || null, input.url || null,
        input.variant || {}, input.targetPrice || null, input.enabled !== false,
        input.sourcePreference || null, input.metadata || {}]
    );
    return normalizeOfferWatch(result.rows[0]);
  }
  const result = await db.query(
    `INSERT INTO product_offer_watches (
       plan_id, product_id, comparable_key, merchant, retailer_product_key, url,
       variant, target_price, enabled, source_preference, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [planId, input.productId || null, input.comparableKey || null, input.merchant || null,
      input.retailerProductKey || null, input.url || null, input.variant || {},
      input.targetPrice || null, input.enabled !== false, input.sourcePreference || null,
      input.metadata || {}]
  );
  return normalizeOfferWatch(result.rows[0]);
}

module.exports = {
  create,
  update,
  listByUser,
  findByIdForUser,
  listActiveByIdentityForUser,
  listPools,
  upsertPool,
  listAllocations,
  reservedHeadroomElsewhere,
  createAllocation,
  releaseAllocation,
  transitionAllocations,
  latestSnapshot,
  listSnapshots,
  createSnapshot,
  upsertOfferWatch,
};
