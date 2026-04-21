const Expense = require('../models/expense');
const MerchantMapping = require('../models/merchantMapping');
const ExpenseItem = require('../models/expenseItem');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const CategoryDecisionEvent = require('../models/categoryDecisionEvent');
const ReceiptLineCorrection = require('../models/receiptLineCorrection');
const detectDuplicates = require('./duplicateDetector');
const { resolveProductMatch } = require('./productResolver');

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

async function appendConfirmPaymentFeedback({ ingestAttemptId, userId, source, parsedPaymentSnapshot, paymentMethod, cardLabel, cardLast4, expenseId }) {
  if (!['manual', 'camera', 'refund'].includes(source) || !ingestAttemptId || !userId) return;
  try {
    await IngestAttemptLog.appendPaymentFeedback(ingestAttemptId, userId, {
      originalPaymentMethod: parsedPaymentSnapshot?.payment_method || null,
      originalCardLabel: parsedPaymentSnapshot?.card_label || null,
      originalCardLast4: parsedPaymentSnapshot?.card_last4 || null,
      finalPaymentMethod: paymentMethod || null,
      finalCardLabel: cardLabel || null,
      finalCardLast4: cardLast4 || null,
    });
    await IngestAttemptLog.markConfirmed(ingestAttemptId, userId, { expenseId });
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

async function createConfirmedExpense({
  user,
  payload,
  originalParsedItems = [],
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

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    const resolvedItems = await Promise.all(
      payload.items.map((item) => enrichItemWithResolution(item, payload.merchant))
    );
    await ExpenseItem.createBulk(expense.id, resolvedItems);
    if (payload.source === 'camera') {
      await captureReceiptLineCorrections({
        householdId: user?.household_id,
        merchant: payload.merchant,
        originalItems: originalParsedItems,
        resolvedItems,
      });
    }
  }

  await appendConfirmPaymentFeedback({
    ingestAttemptId: payload.ingest_attempt_id,
    userId: user.id,
    source: payload.source,
    parsedPaymentSnapshot: payload.parsed_payment_snapshot,
    paymentMethod: payload.payment_method,
    cardLabel: payload.card_label,
    cardLast4: payload.card_last4,
    expenseId: expense.id,
  });

  await updateMerchantMemory({
    categoryId: payload.category_id,
    householdId: user?.household_id,
    merchant: payload.merchant,
  });

  try {
    await recordCategoryDecision({ user, expense, payload });
  } catch (categoryDecisionErr) {
    console.error('Category decision log failed (non-fatal):', categoryDecisionErr.message);
  }

  const duplicateFlags = await detectDuplicateFlags(expense);
  return { expense, duplicate_flags: duplicateFlags };
}

module.exports = {
  createConfirmedExpense,
  normalizeBudgetExclusionReason,
  updateMerchantMemory,
  validateConfirmExpensePayload,
};
