const db = require('../db');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const ExpenseItem = require('../models/expenseItem');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const CategoryDecisionEvent = require('../models/categoryDecisionEvent');
const ReceiptLineCorrection = require('../models/receiptLineCorrection');
const ExpenseReceiptDetail = require('../models/expenseReceiptDetail');
const DuplicateFlag = require('../models/duplicateFlag');
const BackgroundJob = require('../models/backgroundJob');
const User = require('../models/user');
const detectDuplicates = require('./duplicateDetector');
const { resolveProductMatch } = require('./productResolver');
const { assignCategory } = require('./categoryAssigner');
const { searchPlace } = require('./mapkitService');
const { validateExpenseCoreFields } = require('./expenseValidation');

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
    idempotency_key,
  } = payload;

  const coreValidation = validateExpenseCoreFields(payload);
  if (coreValidation.error) return coreValidation;

  if (items !== undefined && !Array.isArray(items)) {
    return { error: 'items must be an array', reason: 'invalid_items' };
  }

  if (Array.isArray(items) && items.length > 250) {
    return { error: 'items cannot contain more than 250 rows', reason: 'too_many_items' };
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

  if (idempotency_key !== undefined && idempotency_key !== null) {
    const normalizedKey = `${idempotency_key}`.trim();
    if (!normalizedKey || normalizedKey.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(normalizedKey)) {
      return { error: 'idempotency_key is invalid', reason: 'invalid_idempotency_key' };
    }
  }

  const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(budget_exclusion_reason);
  if (exclude_from_budget && !normalizedBudgetExclusionReason) {
    return {
      error: 'budget_exclusion_reason required when exclude_from_budget is true',
      reason: 'missing_budget_exclusion_reason',
    };
  }

  const latitude = payload.location_latitude;
  const longitude = payload.location_longitude;
  const confidence = payload.location_confidence;
  if (latitude != null && (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90)) {
    return { error: 'location_latitude must be between -90 and 90', reason: 'invalid_location_latitude' };
  }
  if (longitude != null && (!Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180)) {
    return { error: 'location_longitude must be between -180 and 180', reason: 'invalid_location_longitude' };
  }
  if (confidence != null && (!Number.isFinite(Number(confidence)) || Number(confidence) < 0 || Number(confidence) > 1)) {
    return { error: 'location_confidence must be between 0 and 1', reason: 'invalid_location_confidence' };
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
  const storeNumber = `${payload.receipt_details?.store_number || ''}`.trim();
  if (address) return [primary, storeNumber ? `Store ${storeNumber}` : null, address].filter(Boolean).join(' ');
  if (primary && storeNumber) return `${primary} Store ${storeNumber}`;
  return null;
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
    const matchedLocation = await searchPlace(query, null, null, 500, { intent: 'receipt' });
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
      location_provider_id: matchedLocation.provider_place_id || payload.location_provider_id || null,
      location_latitude: matchedLocation.latitude ?? payload.location_latitude ?? null,
      location_longitude: matchedLocation.longitude ?? payload.location_longitude ?? null,
      location_source: 'receipt',
      location_confidence: matchedLocation.mapkit_stable_id ? 0.95 : 0.5,
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

async function enrichItemWithResolution(item, merchant, { householdId = null } = {}) {
  const resolution = await resolveProductMatch(item, merchant, { householdId });
  return {
    ...item,
    product_id: resolution?.product_id || null,
    product_match_confidence: resolution?.confidence || null,
    product_match_reason: resolution?.reason || null,
  };
}

async function captureReceiptLineCorrections({ householdId, merchant, originalItems = [], resolvedItems = [] }) {
  if (!householdId || !merchant) return;
  const sourceItems = Array.isArray(originalItems) ? originalItems : [];
  const nextItems = Array.isArray(resolvedItems) ? resolvedItems : [];
  const resolvedByObservationKey = new Map(nextItems
    .filter((item) => item?.observation_key)
    .map((item) => [item.observation_key, item]));
  const pairCount = sourceItems.length;

  for (let i = 0; i < pairCount; i += 1) {
    const sourceItem = sourceItems[i];
    const nextItem = sourceItem?.observation_key
      ? resolvedByObservationKey.get(sourceItem.observation_key)
      : nextItems[i];
    if (!nextItem) continue;
    const rawLabel = `${sourceItem?.raw_description || sourceItem?.description || ''}`.trim();
    const correctedLabel = `${nextItem?.description || ''}`.trim();
    if (!rawLabel || !correctedLabel) continue;
    if (rawLabel.toLowerCase() === correctedLabel.toLowerCase()) continue;
    await ReceiptLineCorrection.upsert({
      householdId,
      merchant,
      rawLabel,
      correctedLabel,
      productId: nextItem?.product_id || null,
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
  originalItems = [],
  finalItems = [],
  expenseId,
}) {
  if (!['manual', 'camera', 'refund'].includes(source) || !ingestAttemptId || !userId) return;
  try {
    const attempt = await IngestAttemptLog.findByIdForUser(ingestAttemptId, userId);
    const parsedSnapshot = attempt?.metadata?.parsed_snapshot || null;
    const itemCorrectionSummary = summarizeItemCorrections(originalItems, finalItems);
    const correctionFeedback = parsedSnapshot || itemCorrectionSummary.original_count > 0 ? {
      correction_feedback_recorded: true,
      correction_changed_fields: (parsedSnapshot ? [
        ['merchant', parsedSnapshot.merchant, merchant],
        ['description', parsedSnapshot.description, description],
        ['amount', parsedSnapshot.amount, amount],
        ['date', parsedSnapshot.date, date],
        ['place_name', parsedSnapshot.place_name, placeName],
        ['address', parsedSnapshot.address, address],
        ['mapkit_stable_id', parsedSnapshot.mapkit_stable_id, mapkitStableId],
        ['item_count', parsedSnapshot.item_count, itemCount],
      ] : [])
        .filter(([, originalValue, finalValue]) => `${originalValue ?? ''}` !== `${finalValue ?? ''}`)
        .map(([field]) => field)
        .concat(itemCorrectionSummary.changed_count > 0 ? ['items'] : []),
      item_correction_summary: itemCorrectionSummary,
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

function summarizeItemCorrections(originalItems = [], finalItems = []) {
  const original = Array.isArray(originalItems) ? originalItems : [];
  const final = Array.isArray(finalItems) ? finalItems : [];
  const originalByKey = new Map(original
    .filter((item) => item?.observation_key)
    .map((item) => [item.observation_key, item]));
  let descriptionsChanged = 0;
  let amountsChanged = 0;
  let quantitiesChanged = 0;
  let unitPricesChanged = 0;
  let changedCount = Math.abs(original.length - final.length);

  final.forEach((item, index) => {
    const prior = (item?.observation_key && originalByKey.get(item.observation_key)) || original[index];
    if (!prior) return;
    let rowChanged = false;
    const compareText = (left, right) => `${left ?? ''}`.trim() === `${right ?? ''}`.trim();
    const compareNumber = (left, right) => {
      if ((left == null || left === '') && (right == null || right === '')) return true;
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && Math.abs(leftNumber - rightNumber) < 0.001;
    };
    if (!compareText(prior.description, item?.description)) {
      descriptionsChanged += 1;
      rowChanged = true;
    }
    if (!compareNumber(prior.amount, item?.amount)) {
      amountsChanged += 1;
      rowChanged = true;
    }
    if (!compareNumber(prior.quantity, item?.quantity)) {
      quantitiesChanged += 1;
      rowChanged = true;
    }
    if (!compareNumber(prior.unit_price, item?.unit_price)) {
      unitPricesChanged += 1;
      rowChanged = true;
    }
    if (rowChanged) changedCount += 1;
  });

  return {
    original_count: original.length,
    final_count: final.length,
    changed_count: changedCount,
    descriptions_changed: descriptionsChanged,
    amounts_changed: amountsChanged,
    quantities_changed: quantitiesChanged,
    unit_prices_changed: unitPricesChanged,
  };
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

function durableConfirmPayload(payload = {}) {
  const receiptDetails = payload.receipt_details && typeof payload.receipt_details === 'object'
    ? { store_number: payload.receipt_details.store_number || null }
    : null;
  const parsedPaymentSnapshot = payload.parsed_payment_snapshot && typeof payload.parsed_payment_snapshot === 'object'
    ? {
      payment_method: payload.parsed_payment_snapshot.payment_method || null,
      card_label: payload.parsed_payment_snapshot.card_label || null,
      card_last4: payload.parsed_payment_snapshot.card_last4 || null,
    }
    : null;
  return {
    merchant: payload.merchant || null,
    description: payload.description || null,
    amount: payload.amount ?? null,
    date: payload.date || null,
    source: payload.source || null,
    category_id: payload.category_id || null,
    suggested_category_id: payload.suggested_category_id || null,
    category_source: payload.category_source || null,
    category_confidence: payload.category_confidence ?? null,
    category_reasoning: payload.category_reasoning || null,
    category_status: payload.category_status || null,
    category_user_owned: Boolean(payload.category_user_owned),
    place_name: payload.place_name || null,
    address: payload.address || null,
    mapkit_stable_id: payload.mapkit_stable_id || null,
    location_provider_id: payload.location_provider_id || null,
    location_latitude: payload.location_latitude ?? null,
    location_longitude: payload.location_longitude ?? null,
    location_source: payload.location_source || null,
    location_status: payload.location_status || null,
    location_confidence: payload.location_confidence ?? null,
    location_user_owned: Boolean(payload.location_user_owned),
    payment_method: payload.payment_method || null,
    card_label: payload.card_label || null,
    card_last4: payload.card_last4 || null,
    is_private: payload.is_private === true,
    ingest_attempt_id: payload.ingest_attempt_id || null,
    parsed_payment_snapshot: parsedPaymentSnapshot,
    receipt_details: receiptDetails,
  };
}

async function enqueuePostConfirmSideEffects({
  user,
  payload,
  expense,
  originalParsedItems = [],
  queryable = db,
}) {
  return BackgroundJob.enqueue({
    jobType: BackgroundJob.JOB_TYPES.postConfirm,
    dedupeKey: expense.id,
    payload: {
      user_id: user.id,
      expense_id: expense.id,
      confirm_payload: durableConfirmPayload(payload),
      original_parsed_items: (Array.isArray(originalParsedItems) ? originalParsedItems : [])
        .slice(0, 250)
        .map((item) => ({
          observation_key: item?.observation_key || null,
          description: `${item?.description || ''}`.slice(0, 500),
          raw_description: `${item?.raw_description || item?.description || ''}`.slice(0, 500),
          amount: item?.amount ?? null,
          quantity: item?.quantity ?? null,
          unit_price: item?.unit_price ?? null,
        })),
    },
    queryable,
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

  if (shouldResolveDeferredLocation(originalPayload)) {
    const updatedLocationExpense = await Expense.applyDeferredLocation(expense.id, user.id, {
      originalPlaceName: originalPayload.place_name || null,
      originalAddress: originalPayload.address || null,
      placeName: resolvedPayload.place_name || null,
      address: resolvedPayload.address || null,
      mapkitStableId: resolvedPayload.mapkit_stable_id || null,
      locationProviderId: resolvedPayload.location_provider_id || null,
      locationLatitude: resolvedPayload.location_latitude ?? null,
      locationLongitude: resolvedPayload.location_longitude ?? null,
      locationSource: resolvedPayload.location_source || null,
      locationStatus: resolvedPayload.location_status || null,
      locationConfidence: resolvedPayload.location_confidence ?? null,
      locationUserOwned: Boolean(resolvedPayload.location_user_owned),
    });
    if (updatedLocationExpense) {
      nextExpense = updatedLocationExpense;
    }
  }

  return nextExpense;
}

async function enrichPersistedItems({ expenseId, items, merchant, householdId = null }) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const resolvedItems = await Promise.all(
    items.map((item) => enrichItemWithResolution(item, merchant, { householdId }))
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
  precomputedDuplicateFlags = null,
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
    householdId: user?.household_id || null,
  });

  if (resolvedPayload.source === 'camera' && resolvedItems.length > 0 && resolvedPayload.is_private !== true) {
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
    originalItems: originalParsedItems,
    finalItems: resolvedItems,
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

  const duplicateFlags = Array.isArray(precomputedDuplicateFlags)
    ? precomputedDuplicateFlags
    : await detectDuplicateFlags(enrichedExpense);
  return { expense: enrichedExpense, duplicate_flags: duplicateFlags };
}

async function runPostConfirmJob(jobPayload = {}) {
  const [user, expense, items] = await Promise.all([
    User.findById(jobPayload.user_id),
    Expense.findById(jobPayload.expense_id),
    ExpenseItem.findByExpenseId(jobPayload.expense_id),
  ]);
  if (!user || !expense || expense.user_id !== user.id) {
    return { skipped: true, reason: !user ? 'user_missing' : 'expense_missing' };
  }

  const originalPayload = jobPayload.confirm_payload || {};
  const payload = {
    ...expense,
    ...originalPayload,
    merchant: expense.merchant || originalPayload.merchant,
    description: expense.description || originalPayload.description,
    amount: expense.amount ?? originalPayload.amount,
    date: expense.date || originalPayload.date,
    source: expense.source || originalPayload.source,
    category_id: expense.category_id || originalPayload.category_id || null,
    payment_method: expense.payment_method || originalPayload.payment_method,
    card_label: expense.card_label || originalPayload.card_label,
    card_last4: expense.card_last4 || originalPayload.card_last4,
    is_private: expense.is_private === true,
  };
  return runPostConfirmSideEffects({
    user,
    payload,
    expense,
    items,
    originalParsedItems: jobPayload.original_parsed_items || [],
    precomputedDuplicateFlags: [],
  });
}

async function createConfirmedExpense({
  user,
  payload,
  originalParsedItems = [],
  deferPostConfirmSideEffects = shouldDeferPostConfirmSideEffects(),
  queuePostConfirm = enqueuePostConfirmSideEffects,
}) {
  const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(payload.budget_exclusion_reason);
  const client = await db.pool.connect();
  let expense;
  let idempotentReplay = false;
  let createdItems = [];
  let receiptDetails = null;
  try {
    await client.query('BEGIN');
    const createdExpense = await Expense.create({
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
      locationProviderId: payload.location_provider_id || null,
      locationLatitude: payload.location_latitude ?? null,
      locationLongitude: payload.location_longitude ?? null,
      locationSource: payload.location_source || null,
      locationStatus: payload.location_status || null,
      locationConfidence: payload.location_confidence ?? null,
      locationUserOwned: Boolean(payload.location_user_owned),
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
      idempotencyKey: payload.idempotency_key || null,
      queryable: client,
    });

    idempotentReplay = createdExpense?._idempotent_replay === true;
    const { _idempotent_replay: ignoredReplayMarker, ...persistedExpense } = createdExpense;
    expense = persistedExpense;
    if (!idempotentReplay) {
      createdItems = Array.isArray(payload.items) && payload.items.length > 0
        ? await ExpenseItem.createBulk(expense.id, payload.items.map((item) => ({
          ...item,
          source_type: item.source_type || payload.source || null,
          raw_description: item.raw_description || item.description || null,
          extraction_confidence: item.extraction_confidence || (payload.source === 'manual' ? 'high' : null),
        })), client)
        : [];
      receiptDetails = payload.receipt_details
        ? await ExpenseReceiptDetail.upsert(expense.id, payload.receipt_details, client)
        : null;
      if (deferPostConfirmSideEffects) {
        await queuePostConfirm({
          user,
          payload,
          expense,
          originalParsedItems,
          queryable: client,
        });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Confirm expense rollback failed:', rollbackErr?.message || rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }

  if (idempotentReplay) {
    const duplicateFlags = await DuplicateFlag.findByExpenseId(expense.id, {
      userId: user.id,
      pendingOnly: true,
    });
    return { expense, duplicate_flags: duplicateFlags, idempotent_replay: true };
  }

  let duplicateFlags = [];
  try {
    duplicateFlags = await detectDuplicateFlags({
      ...expense,
      receipt_details: receiptDetails || payload.receipt_details || null,
    });
  } catch (err) {
    console.error('Duplicate detection failed (non-fatal):', err?.message || err);
  }

  if (deferPostConfirmSideEffects) {
    return { expense, duplicate_flags: duplicateFlags };
  }

  return runPostConfirmSideEffects({
    user,
    payload,
    expense,
    items: createdItems,
    originalParsedItems,
    precomputedDuplicateFlags: duplicateFlags,
  });
}

module.exports = {
  createConfirmedExpense,
  summarizeItemCorrections,
  normalizeBudgetExclusionReason,
  durableConfirmPayload,
  enqueuePostConfirmSideEffects,
  resolveDeferredConfirmPayload,
  runPostConfirmJob,
  runPostConfirmSideEffects,
  queuePostConfirmSideEffects: enqueuePostConfirmSideEffects,
  updateMerchantMemory,
  validateConfirmExpensePayload,
};
