const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const ExpenseItem = require('../models/expenseItem');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const CategoryDecisionEvent = require('../models/categoryDecisionEvent');
const ReceiptLineCorrection = require('../models/receiptLineCorrection');
const detectDuplicates = require('./duplicateDetector');
const { resolveProductMatch } = require('./productResolver');
const { assignCategory } = require('./categoryAssigner');
const { searchPlace } = require('./mapkitService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeBudgetExclusionReason(value) {
  const normalized = `${value || ''}`.trim();
  return normalized || null;
}

function validateConfirmExpensePayload(payload = {}) {
  const {
    amount,
    date,
    source,
    items,
    category_id,
    suggested_category_id,
    exclude_from_budget,
    budget_exclusion_reason,
  } = payload;

  if (!amount || !date || !source) {
    return { error: 'amount, date, source required', reason: 'missing_required_fields' };
  }

  if (Array.isArray(items) && items.some((item) => !item.description || typeof item.description !== 'string' || item.description.trim() === '')) {
    return { error: 'Each item must have a non-empty description', reason: 'invalid_items' };
  }

  if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
    return { error: 'category_id must be a valid UUID', reason: 'invalid_category_id' };
  }

  if (suggested_category_id !== undefined && suggested_category_id !== null && !UUID_RE.test(suggested_category_id)) {
    return { error: 'suggested_category_id must be a valid UUID', reason: 'invalid_suggested_category_id' };
  }

  const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(budget_exclusion_reason);
  if (exclude_from_budget && !normalizedBudgetExclusionReason) {
    return {
      error: 'budget_exclusion_reason required when exclude_from_budget is true',
      reason: 'missing_budget_exclusion_reason',
    };
  }

  return {
    error: null,
    reason: null,
    normalizedBudgetExclusionReason,
  };
}

function normalizeStatus(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  return normalized || null;
}

function shouldResolveDeferredCategory(payload = {}) {
  return normalizeStatus(payload.category_status) === 'deferred'
    && !payload.category_user_owned
    && !payload.category_id;
}

function shouldResolveDeferredLocation(payload = {}) {
  return normalizeStatus(payload.location_status) === 'deferred'
    && !payload.location_user_owned
    && !payload.mapkit_stable_id;
}

function buildDeferredLocationQuery(payload = {}) {
  const primary = `${payload.place_name || payload.merchant || ''}`.trim();
  const address = `${payload.address || ''}`.trim();
  if (!primary && !address) return null;
  if (address && address.toLowerCase() !== primary.toLowerCase()) {
    return [primary, address].filter(Boolean).join(' ');
  }
  return primary || address;
}

async function resolveDeferredCategoryOnConfirm({ user, payload }) {
  if (!shouldResolveDeferredCategory(payload)) return payload;

  const categories = await Category.findByHousehold(user?.household_id);
  if (!Array.isArray(categories) || categories.length === 0) {
    return {
      ...payload,
      category_status: 'skipped',
      category_source: payload.category_source || 'deferred',
      category_confidence: payload.category_confidence ?? 0,
      category_reasoning: payload.category_reasoning || {
        strategy: 'fallback_gate',
        label: 'No categories available',
        detail: 'Confirm skipped deferred category enrichment because the household has no categories configured.',
        fallback_skipped_reason: 'no_categories',
      },
    };
  }

  const assignment = await assignCategory({
    merchant: payload.merchant,
    description: payload.description,
    householdId: user?.household_id,
    categories,
    allowDeferredFallback: true,
  });

  return {
    ...payload,
    category_id: assignment.category_id || null,
    category_source: assignment.source || payload.category_source || null,
    category_confidence: assignment.confidence ?? payload.category_confidence ?? null,
    category_reasoning: assignment.reasoning || payload.category_reasoning || null,
    category_status: assignment.category_id ? 'assigned' : 'skipped',
  };
}

async function resolveDeferredLocationOnConfirm({ payload }) {
  if (!shouldResolveDeferredLocation(payload)) return payload;

  const query = buildDeferredLocationQuery(payload);
  if (!query) {
    return {
      ...payload,
      location_status: 'missing',
    };
  }

  try {
    const matchedLocation = await searchPlace(query);
    if (!matchedLocation) {
      return {
        ...payload,
        location_status: 'missing',
      };
    }
    return {
      ...payload,
      place_name: matchedLocation.place_name || payload.place_name || null,
      address: matchedLocation.address || payload.address || null,
      mapkit_stable_id: matchedLocation.mapkit_stable_id || payload.mapkit_stable_id || null,
      location_status: matchedLocation.mapkit_stable_id ? 'enriched' : 'missing',
    };
  } catch {
    return {
      ...payload,
      location_status: 'failed',
    };
  }
}

async function resolveDeferredConfirmPayload({ user, payload }) {
  const categoryResolvedPayload = await resolveDeferredCategoryOnConfirm({ user, payload });
  return resolveDeferredLocationOnConfirm({ payload: categoryResolvedPayload });
}

async function enrichItemWithResolution(item, merchant) {
  const resolution = await resolveProductMatch(item, merchant);
  return {
    ...item,
    product_id: resolution?.confidence === 'high' ? resolution.product_id : null,
    product_match_confidence: resolution?.confidence || null,
    product_match_reason: resolution?.reason || null,
  };
}

async function captureReceiptLineCorrections({ householdId, merchant, originalItems = [], resolvedItems = [] }) {
  if (!householdId || !merchant) return;
  const sourceItems = Array.isArray(originalItems) ? originalItems : [];
  const nextItems = Array.isArray(resolvedItems) ? resolvedItems : [];
  const pairCount = Math.min(sourceItems.length, nextItems.length);

  for (let i = 0; i < pairCount; i += 1) {
    const rawLabel = `${sourceItems[i]?.description || ''}`.trim();
    const correctedLabel = `${nextItems[i]?.description || ''}`.trim();
    if (!rawLabel || !correctedLabel) continue;
    if (rawLabel.toLowerCase() === correctedLabel.toLowerCase()) continue;
    await ReceiptLineCorrection.upsert({
      householdId,
      merchant,
      rawLabel,
      correctedLabel,
      productId: nextItems[i]?.product_id || null,
    });
  }
}

async function appendConfirmPaymentFeedback({
  ingestAttemptId,
  userId,
  source,
  parsedPaymentSnapshot,
  paymentMethod,
  cardLabel,
  cardLast4,
  merchant,
  description,
  amount,
  date,
  placeName,
  address,
  mapkitStableId,
  itemCount,
  expenseId,
}) {
  if (!['manual', 'camera', 'refund'].includes(source) || !ingestAttemptId || !userId) return;
  try {
    const attempt = await IngestAttemptLog.findByIdForUser(ingestAttemptId, userId);
    const parsedSnapshot = attempt?.metadata?.parsed_snapshot || null;
    const correctionFeedback = parsedSnapshot ? {
      correction_feedback_recorded: true,
      correction_changed_fields: [
        ['merchant', parsedSnapshot.merchant, merchant],
        ['description', parsedSnapshot.description, description],
        ['amount', parsedSnapshot.amount, amount],
        ['date', parsedSnapshot.date, date],
        ['place_name', parsedSnapshot.place_name, placeName],
        ['address', parsedSnapshot.address, address],
        ['mapkit_stable_id', parsedSnapshot.mapkit_stable_id, mapkitStableId],
        ['item_count', parsedSnapshot.item_count, itemCount],
      ]
        .filter(([, originalValue, finalValue]) => `${originalValue ?? ''}` !== `${finalValue ?? ''}`)
        .map(([field]) => field),
    } : null;

    await IngestAttemptLog.appendPaymentFeedback(ingestAttemptId, userId, {
      originalPaymentMethod: parsedPaymentSnapshot?.payment_method || null,
      originalCardLabel: parsedPaymentSnapshot?.card_label || null,
      originalCardLast4: parsedPaymentSnapshot?.card_last4 || null,
      finalPaymentMethod: paymentMethod || null,
      finalCardLabel: cardLabel || null,
      finalCardLast4: cardLast4 || null,
    });
    await IngestAttemptLog.markConfirmed(ingestAttemptId, userId, {
      expenseId,
      correctionFeedback,
    });
  } catch (logErr) {
    console.error('Confirm ingest log update failed (non-fatal):', logErr.message);
  }
}

async function updateMerchantMemory({ categoryId, householdId, merchant }) {
  if (!categoryId || !householdId || !`${merchant || ''}`.trim()) return;
  await MerchantMapping.upsert({
    householdId,
    merchantName: merchant,
    categoryId,
  });
}

async function recordCategoryDecision({
  user,
  expense,
  payload,
}) {
  await CategoryDecisionEvent.create({
    userId: user?.id,
    householdId: user?.household_id || null,
    expenseId: expense?.id || null,
    eventType: 'confirm',
    merchantName: payload?.merchant || null,
    description: payload?.description || null,
    suggestedCategoryId: payload?.suggested_category_id || null,
    previousCategoryId: null,
    finalCategoryId: expense?.category_id || payload?.category_id || null,
    suggestionSource: payload?.category_source || null,
    suggestionConfidence: payload?.category_confidence ?? null,
  });
}

async function detectDuplicateFlags(expense) {
  try {
    const expenseDate = expense.date instanceof Date
      ? expense.date.toISOString().split('T')[0]
      : expense.date;
    return await detectDuplicates({
      id: expense.id,
      householdId: expense.household_id,
      merchant: expense.merchant,
      amount: expense.amount,
      date: expenseDate,
      mapkit_stable_id: expense.mapkit_stable_id,
    });
  } catch (dupErr) {
    console.error('Dedup error (non-fatal):', dupErr);
    return [];
  }
}

function shouldDeferPostConfirmSideEffects() {
  const configured = `${process.env.CONFIRM_DEFER_SIDE_EFFECTS || ''}`.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(configured)) return true;
  if (['0', 'false', 'off', 'no'].includes(configured)) return false;
  return process.env.NODE_ENV !== 'test';
}

function queuePostConfirmSideEffects(task) {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => {
        console.error('Deferred confirm side effects failed (non-fatal):', err?.message || err);
      });
  });
}

async function applyDeferredExpenseEnrichment({ user, expense, originalPayload, resolvedPayload }) {
  let nextExpense = expense;

  if (shouldResolveDeferredCategory(originalPayload) && resolvedPayload.category_id) {
    const updatedCategoryExpense = await Expense.applyDeferredCategory(expense.id, user.id, {
      categoryId: resolvedPayload.category_id,
      categorySource: resolvedPayload.category_source || null,
      categoryConfidence: resolvedPayload.category_confidence ?? null,
      categoryReasoning: resolvedPayload.category_reasoning || null,
    });
    if (updatedCategoryExpense) {
      nextExpense = updatedCategoryExpense;
    }
  }

  if (shouldResolveDeferredLocation(originalPayload) && resolvedPayload.mapkit_stable_id) {
    const updatedLocationExpense = await Expense.applyDeferredLocation(expense.id, user.id, {
      originalPlaceName: originalPayload.place_name || null,
      originalAddress: originalPayload.address || null,
      placeName: resolvedPayload.place_name || null,
      address: resolvedPayload.address || null,
      mapkitStableId: resolvedPayload.mapkit_stable_id || null,
    });
    if (updatedLocationExpense) {
      nextExpense = updatedLocationExpense;
    }
  }

  return nextExpense;
}

async function enrichPersistedItems({ expenseId, items, merchant }) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const resolvedItems = await Promise.all(
    items.map((item) => enrichItemWithResolution(item, merchant))
  );

  await Promise.all(
    resolvedItems.map((item, index) => {
      const existing = items[index];
      if (!existing?.id) return null;

      const nextProductId = item?.product_id || null;
      const nextConfidence = item?.product_match_confidence || null;
      const nextReason = item?.product_match_reason || null;

      if (
        `${existing.product_id || ''}` === `${nextProductId || ''}`
        && `${existing.product_match_confidence || ''}` === `${nextConfidence || ''}`
        && `${existing.product_match_reason || ''}` === `${nextReason || ''}`
      ) {
        return null;
      }

      return ExpenseItem.updateResolution(existing.id, expenseId, {
        productId: nextProductId,
        productMatchConfidence: nextConfidence,
        productMatchReason: nextReason,
      });
    })
  );

  return resolvedItems;
}

async function runPostConfirmSideEffects({
  user,
  payload,
  expense,
  items = [],
  originalParsedItems = [],
}) {
  const resolvedPayload = await resolveDeferredConfirmPayload({ user, payload });
  const enrichedExpense = await applyDeferredExpenseEnrichment({
    user,
    expense,
    originalPayload: payload,
    resolvedPayload,
  });

  const resolvedItems = await enrichPersistedItems({
    expenseId: expense.id,
    items,
    merchant: enrichedExpense.merchant || resolvedPayload.merchant,
  });

  if (resolvedPayload.source === 'camera' && resolvedItems.length > 0) {
    await captureReceiptLineCorrections({
      householdId: user?.household_id,
      merchant: enrichedExpense.merchant || resolvedPayload.merchant,
      originalItems: originalParsedItems,
      resolvedItems,
    });
  }

  await appendConfirmPaymentFeedback({
    ingestAttemptId: resolvedPayload.ingest_attempt_id,
    userId: user.id,
    source: resolvedPayload.source,
    parsedPaymentSnapshot: resolvedPayload.parsed_payment_snapshot,
    paymentMethod: enrichedExpense.payment_method || resolvedPayload.payment_method,
    cardLabel: enrichedExpense.card_label || resolvedPayload.card_label,
    cardLast4: enrichedExpense.card_last4 || resolvedPayload.card_last4,
    merchant: enrichedExpense.merchant || resolvedPayload.merchant,
    description: enrichedExpense.description || resolvedPayload.description,
    amount: enrichedExpense.amount || resolvedPayload.amount,
    date: enrichedExpense.date || resolvedPayload.date,
    placeName: enrichedExpense.place_name || resolvedPayload.place_name,
    address: enrichedExpense.address || resolvedPayload.address,
    mapkitStableId: enrichedExpense.mapkit_stable_id || resolvedPayload.mapkit_stable_id,
    itemCount: Array.isArray(items) ? items.length : 0,
    expenseId: expense.id,
  });

  await updateMerchantMemory({
    categoryId: enrichedExpense.category_id || resolvedPayload.category_id,
    householdId: user?.household_id,
    merchant: enrichedExpense.merchant || resolvedPayload.merchant,
  });

  try {
    await recordCategoryDecision({
      user,
      expense: enrichedExpense,
      payload: {
        ...resolvedPayload,
        category_id: enrichedExpense.category_id || resolvedPayload.category_id || null,
        category_source: resolvedPayload.category_source || enrichedExpense.category_source || null,
        category_confidence: resolvedPayload.category_confidence ?? enrichedExpense.category_confidence ?? null,
        category_reasoning: resolvedPayload.category_reasoning || enrichedExpense.category_reasoning || null,
      },
    });
  } catch (categoryDecisionErr) {
    console.error('Category decision log failed (non-fatal):', categoryDecisionErr.message);
  }

  const duplicateFlags = await detectDuplicateFlags(enrichedExpense);
  return { expense: enrichedExpense, duplicate_flags: duplicateFlags };
}

async function createConfirmedExpense({
  user,
  payload,
  originalParsedItems = [],
  deferPostConfirmSideEffects = shouldDeferPostConfirmSideEffects(),
  queuePostConfirm = queuePostConfirmSideEffects,
}) {
  const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(payload.budget_exclusion_reason);
  const expense = await Expense.create({
    userId: user.id,
    householdId: user?.household_id,
    merchant: payload.merchant,
    description: payload.description,
    amount: payload.amount,
    date: payload.date,
    categoryId: payload.category_id,
    source: payload.source,
    status: 'confirmed',
    notes: payload.notes,
    placeName: payload.place_name,
    address: payload.address,
    mapkitStableId: payload.mapkit_stable_id,
    linkedExpenseId: payload.linked_expense_id,
    paymentMethod: payload.payment_method,
    cardLast4: payload.card_last4,
    cardLabel: payload.card_label,
    isPrivate: payload.is_private ?? false,
    excludeFromBudget: payload.exclude_from_budget ?? false,
    budgetExclusionReason: payload.exclude_from_budget ? normalizedBudgetExclusionReason : null,
    categorySource: payload.category_source || null,
    categoryConfidence: payload.category_confidence ?? null,
    categoryReasoning: payload.category_reasoning || null,
  });

  const createdItems = Array.isArray(payload.items) && payload.items.length > 0
    ? await ExpenseItem.createBulk(expense.id, payload.items)
    : [];

  if (deferPostConfirmSideEffects) {
    queuePostConfirm(() => runPostConfirmSideEffects({
      user,
      payload,
      expense,
      items: createdItems,
      originalParsedItems,
    }));
    return { expense, duplicate_flags: [] };
  }

  return runPostConfirmSideEffects({
    user,
    payload,
    expense,
    items: createdItems,
    originalParsedItems,
  });
}

module.exports = {
  createConfirmedExpense,
  normalizeBudgetExclusionReason,
  resolveDeferredConfirmPayload,
  runPostConfirmSideEffects,
  queuePostConfirmSideEffects,
  updateMerchantMemory,
  validateConfirmExpensePayload,
};
