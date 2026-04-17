const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Household = require('../models/household');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const ReceiptLineCorrection = require('../models/receiptLineCorrection');
const { classifyExpenseItemType } = require('../services/itemClassifier');
const { parseExpenseDetailed } = require('../services/nlParser');
const { parseReceiptDetailed } = require('../services/receiptParser');
const { assignCategory } = require('../services/categoryAssigner');
const detectDuplicates = require('../services/duplicateDetector');
const { resolveProductMatch } = require('../services/productResolver');
const { searchPlace } = require('../services/mapkitService');
const { buildReceiptParsingContext } = require('../services/receiptContextService');
const {
  attachExpenseReviewContext,
  attachExpensesReviewContext,
  fetchPendingExpensesBase,
} = require('../services/expenseReviewContext');
const db = require('../db');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

function canViewExpense(user, expense) {
  if (!user || !expense) return false;
  if (expense.user_id === user.id) return true;
  const inSameHousehold = !!(user.household_id && expense.household_id === user.household_id);
  if (!inSameHousehold) return false;
  return expense.is_private !== true;
}

function canDeleteExpense(user, expense) {
  if (!user || !expense) return false;
  return expense.user_id === user.id;
}

function collectChangedFields(originalExpense, patch = {}) {
  const changedFields = [];
  const fieldPairs = [
    ['merchant', patch.merchant],
    ['amount', patch.amount],
    ['date', patch.date],
    ['category_id', patch.category_id],
    ['notes', patch.notes],
    ['payment_method', patch.payment_method],
    ['card_last4', patch.card_last4],
    ['card_label', patch.card_label],
    ['is_private', patch.is_private],
    ['exclude_from_budget', patch.exclude_from_budget],
    ['budget_exclusion_reason', patch.budget_exclusion_reason],
    ['place_name', patch.place_name],
    ['address', patch.address],
    ['mapkit_stable_id', patch.mapkit_stable_id],
  ];

  for (const [field, nextValue] of fieldPairs) {
    if (nextValue === undefined) continue;
    const currentValue = originalExpense?.[field];
    if (`${currentValue ?? ''}` !== `${nextValue ?? ''}`) {
      changedFields.push(field);
    }
  }

  if (patch.items !== undefined) changedFields.push('items');
  return [...new Set(changedFields)];
}

function normalizeReviewContext(value) {
  const raw = `${value || ''}`.trim().toLowerCase();
  if (raw === 'quick_check') return 'review_path_quick_check';
  if (raw === 'items_first') return 'review_path_items_first';
  if (raw === 'full_review') return 'review_path_full_review';
  return null;
}

function normalizeDismissalReason(value) {
  const raw = `${value || ''}`.trim().toLowerCase();
  if (raw === 'not_an_expense') return 'dismiss_reason_not_an_expense';
  if (raw === 'duplicate') return 'dismiss_reason_duplicate';
  if (raw === 'business_or_track_only') return 'dismiss_reason_business_or_track_only';
  if (raw === 'transfer_or_payment') return 'dismiss_reason_transfer_or_payment';
  if (raw === 'wrong_details') return 'dismiss_reason_wrong_details';
  if (raw === 'other') return 'dismiss_reason_other';
  return null;
}

function normalizeReviewItem(item = {}, index = 0) {
  const amount = item.amount == null || item.amount === '' ? null : Number(item.amount);
  return {
    description: `${item.description || ''}`.trim(),
    normalized_description: `${item.description || ''}`.trim().toLowerCase(),
    amount,
    item_type: item.item_type || classifyExpenseItemType(item.description),
    sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
  };
}

function subtractSignatureCounts(sourceCounts, targetCounts) {
  const removed = [];
  for (const [signature, count] of sourceCounts.entries()) {
    const remaining = count - (targetCounts.get(signature) || 0);
    for (let i = 0; i < remaining; i += 1) removed.push(signature);
  }
  return removed;
}

function collectItemReviewSignals(originalItems = [], nextItems = []) {
  const signals = [];
  const original = (Array.isArray(originalItems) ? originalItems : []).map(normalizeReviewItem);
  const next = (Array.isArray(nextItems) ? nextItems : []).map(normalizeReviewItem);

  if (!original.length && !next.length) return signals;

  if (original.length !== next.length) signals.push('items_count');

  const compareLength = Math.min(original.length, next.length);
  let descriptionChanged = false;
  let amountChanged = false;
  let typeChanged = false;
  for (let i = 0; i < compareLength; i += 1) {
    if (original[i].normalized_description !== next[i].normalized_description) descriptionChanged = true;
    if (`${original[i].amount ?? ''}` !== `${next[i].amount ?? ''}`) amountChanged = true;
    if (original[i].item_type !== next[i].item_type) typeChanged = true;
  }
  if (descriptionChanged) signals.push('items_description');
  if (amountChanged) signals.push('items_amount');
  if (typeChanged) signals.push('items_type');

  const originalCounts = new Map();
  const nextCounts = new Map();
  const bySignature = new Map();

  for (const item of original) {
    const signature = JSON.stringify([item.normalized_description, item.amount, item.item_type]);
    originalCounts.set(signature, (originalCounts.get(signature) || 0) + 1);
    if (!bySignature.has(signature)) bySignature.set(signature, item);
  }
  for (const item of next) {
    const signature = JSON.stringify([item.normalized_description, item.amount, item.item_type]);
    nextCounts.set(signature, (nextCounts.get(signature) || 0) + 1);
    if (!bySignature.has(signature)) bySignature.set(signature, item);
  }

  const removedRows = subtractSignatureCounts(originalCounts, nextCounts).map((signature) => bySignature.get(signature)).filter(Boolean);
  const addedRows = subtractSignatureCounts(nextCounts, originalCounts).map((signature) => bySignature.get(signature)).filter(Boolean);

  if (removedRows.length) signals.push('items_rows_removed');
  if (addedRows.length) signals.push('items_rows_added');
  if (removedRows.some((item) => item.item_type === 'fee')) signals.push('items_fee_rows_removed');
  if (removedRows.some((item) => item.item_type === 'discount')) signals.push('items_discount_rows_removed');
  if (removedRows.some((item) => item.item_type === 'summary')) signals.push('items_summary_rows_removed');

  return signals;
}

function parseStartDay(value, fallback) {
  if (value === undefined) return fallback;
  const day = parseInt(value, 10);
  if (!Number.isInteger(day) || day < 1 || day > 28) return null;
  return day;
}

function normalizeBudgetExclusionReason(value) {
  const normalized = `${value || ''}`.trim();
  return normalized || null;
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

function normalizeApprovedEmailNotes(notes = '') {
  if (!notes) return notes;
  return `${notes}`
    .replace(/\(\s*needs review\s*\)/ig, '(imported from Gmail)')
    .replace(/\bneeds review\b/ig, 'imported from Gmail')
    .trim();
}

const { aiEndpoints } = require('../middleware/rateLimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function truncateInputPreview(input, max = 180) {
  const text = `${input || ''}`.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildIngestFailure(source, failureReason) {
  const family = source === 'receipt' ? 'receipt' : 'nl';
  return {
    error: family === 'receipt' ? 'Could not parse receipt' : 'Could not parse expense',
    reason_code: failureReason || 'missing_required_fields',
  };
}

function buildParsedPaymentSnapshot(parsed = {}) {
  return {
    payment_method: parsed?.payment_method || null,
    card_label: parsed?.card_label || null,
    card_last4: parsed?.card_last4 || null,
  };
}

function shouldRetryReceiptWithContext(parsedResult, merchantHint = null) {
  if (!parsedResult) return false;
  if (!parsedResult.parsed) {
    return Boolean(merchantHint)
      && !['invalid_model_json', 'truncated_model_output', 'empty_model_response'].includes(parsedResult.failureReason);
  }
  const reviewFields = Array.isArray(parsedResult.parsed.review_fields) ? parsedResult.parsed.review_fields : [];
  return parsedResult.parsed.parse_status === 'partial'
    && reviewFields.some((field) => ['merchant', 'items'].includes(field));
}

function summarizeReceiptOutcome(parsedResult) {
  const parsed = parsedResult?.parsed || null;
  const reviewFields = Array.isArray(parsed?.review_fields) ? parsed.review_fields : [];
  return {
    parsed: Boolean(parsed),
    parse_status: parsed?.parse_status || 'failed',
    review_field_count: reviewFields.length,
    review_fields: reviewFields,
    failure_reason: parsedResult?.failureReason || null,
  };
}

function compareReceiptOutcomes(firstOutcome, finalOutcome) {
  const statusRank = { failed: 0, partial: 1, complete: 2 };
  const firstRank = statusRank[firstOutcome?.parse_status] ?? 0;
  const finalRank = statusRank[finalOutcome?.parse_status] ?? 0;
  const didStatusImprove = finalRank > firstRank;
  const didReviewCountImprove = finalOutcome?.parsed
    && firstOutcome?.parsed
    && Number.isFinite(firstOutcome.review_field_count)
    && Number.isFinite(finalOutcome.review_field_count)
    ? finalOutcome.review_field_count < firstOutcome.review_field_count
    : false;

  return {
    first_pass_status: firstOutcome?.parse_status || 'failed',
    first_pass_review_field_count: firstOutcome?.review_field_count ?? null,
    final_status: finalOutcome?.parse_status || 'failed',
    final_review_field_count: finalOutcome?.review_field_count ?? null,
    did_status_improve: didStatusImprove,
    did_review_count_improve: didReviewCountImprove,
    retry_was_unnecessary:
      finalOutcome?.parse_status === firstOutcome?.parse_status
      && (finalOutcome?.review_field_count ?? null) === (firstOutcome?.review_field_count ?? null),
  };
}

router.get('/ingest-summary', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });

    const days = req.query.days ? Number(req.query.days) : 30;
    const source = req.query.source ? `${req.query.source}`.trim() : null;
    const summary = await IngestAttemptLog.summarizeByUser(user.id, { source, days });
    res.json(summary || { counts: {}, reasons: [] });
  } catch (err) { next(err); }
});

// Parse NL input → structured expense (does NOT save to DB)
router.post('/parse', aiEndpoints, async (req, res, next) => {
  try {
    const { input, today } = req.body;
    if (!input) return res.status(400).json({ error: 'input required' });
    if (input.length > 500) return res.status(400).json({ error: 'input too long (max 500 characters)' });

    const todayDate = today || new Date().toISOString().split('T')[0];
    const userPromise = getUser(req);
    let parsedResult;
    try {
      parsedResult = await parseExpenseDetailed(input, todayDate);
    } catch (err) {
      const user = await userPromise.catch(() => null);
      await IngestAttemptLog.create({
        userId: user?.id || null,
        source: 'nl',
        status: 'failed',
        failureReason: 'ai_unavailable',
        inputPreview: truncateInputPreview(input),
        metadata: {
          error: err.message,
          input_length: `${input || ''}`.trim().length,
        },
      });
      return res.status(503).json(buildIngestFailure('nl', 'ai_unavailable'));
    }
    const user = await userPromise;

    const parsed = parsedResult?.parsed || null;
    if (!parsed) {
      const failure = buildIngestFailure('nl', parsedResult?.failureReason);
      await IngestAttemptLog.create({
        userId: user?.id || null,
        source: 'nl',
        status: 'failed',
        failureReason: failure.reason_code,
        inputPreview: truncateInputPreview(input),
        metadata: parsedResult?.diagnostics || { raw_present: Boolean(parsedResult?.raw) },
      });
      return res.status(422).json(failure);
    }

    const categories = await Category.findByHousehold(user?.household_id);
    const { category_id, source, confidence } = await assignCategory({
      merchant: parsed.merchant,
      description: parsed.description,
      householdId: user?.household_id,
      categories,
    });
    const matchedCat = categories.find(c => c.id === category_id);

      const attempt = await IngestAttemptLog.create({
        userId: user?.id || null,
        source: 'nl',
        status: parsed.parse_status === 'partial' ? 'partial' : 'parsed',
      inputPreview: truncateInputPreview(input),
      parseStatus: parsed.parse_status,
      reviewFields: parsed.review_fields,
      metadata: {
        ...(parsedResult?.diagnostics || {}),
        category_id,
          category_source: source,
          category_confidence: confidence,
        },
      });

    res.json({
      ...parsed,
      ingest_attempt_id: attempt?.id || null,
      parsed_payment_snapshot: buildParsedPaymentSnapshot(parsed),
      category_id,
      category_name: matchedCat?.name || null,
      category_source: source,
      category_confidence: confidence,
    });
  } catch (err) { next(err); }
});

// Scan receipt image → structured expense (does NOT save to DB)
router.post('/scan', aiEndpoints, async (req, res, next) => {
  try {
    const { image_base64, today } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
    if (image_base64.length > 3_000_000) return res.status(400).json({ error: 'image too large (max ~2MB)' });

    const user = await getUser(req);
    const todayDate = today || new Date().toISOString().split('T')[0];
    const scanStartedAt = Date.now();
    let parsedResult;
    let initialParseDurationMs = 0;
    try {
      const initialParseStartedAt = Date.now();
      parsedResult = await parseReceiptDetailed(image_base64, todayDate);
      initialParseDurationMs = Date.now() - initialParseStartedAt;
    } catch (err) {
      await IngestAttemptLog.create({
        userId: user?.id || null,
        source: 'receipt',
        status: 'failed',
        failureReason: 'ai_unavailable',
        metadata: {
          image_size: image_base64.length,
          error: err.message,
        },
      });
      return res.status(503).json(buildIngestFailure('receipt', 'ai_unavailable'));
    }
    const firstPassOutcome = summarizeReceiptOutcome(parsedResult);
    let contextRetryAttempted = false;
    let contextLookupDurationMs = 0;
    let contextRetryDurationMs = 0;
    let contextRetrySkippedReason = null;
    const merchantHint = parsedResult?.parsed?.merchant || parsedResult?.raw?.merchant || null;

    if (user?.household_id && shouldRetryReceiptWithContext(parsedResult, merchantHint)) {
      const contextLookupStartedAt = Date.now();
      const context = await buildReceiptParsingContext({
        householdId: user.household_id,
        merchantHint,
      });
      contextLookupDurationMs = Date.now() - contextLookupStartedAt;

      const hasMerchantSpecificPriors = context.merchant_alias_count > 0 || context.merchant_item_count > 0;
      const hasUsefulFallbackPriors = Boolean(merchantHint) || firstPassOutcome.parse_status === 'partial';
      if (context.prior_count > 0 && (hasMerchantSpecificPriors || hasUsefulFallbackPriors)) {
        contextRetryAttempted = true;
        try {
          const contextRetryStartedAt = Date.now();
          const contextualResult = await parseReceiptDetailed(image_base64, todayDate, { priors: context.priors });
          contextRetryDurationMs = Date.now() - contextRetryStartedAt;
          const contextualParsed = contextualResult?.parsed || null;
          const currentParsed = parsedResult?.parsed || null;
          const currentReviewCount = Array.isArray(currentParsed?.review_fields) ? currentParsed.review_fields.length : 99;
          const contextualReviewCount = Array.isArray(contextualParsed?.review_fields) ? contextualParsed.review_fields.length : 99;
          const isBetter = contextualParsed && (!currentParsed || contextualReviewCount <= currentReviewCount);

          if (isBetter) {
            parsedResult = {
              ...contextualResult,
              diagnostics: {
                ...(contextualResult.diagnostics || {}),
                context_retry_used: true,
                context_prior_count: context.prior_count,
                context_merchant_hint: context.merchant_hint,
              },
            };
          } else if (parsedResult?.diagnostics) {
            parsedResult.diagnostics = {
              ...parsedResult.diagnostics,
              context_retry_used: false,
              context_prior_count: context.prior_count,
              context_merchant_hint: context.merchant_hint,
            };
          }
        } catch {
          contextRetryDurationMs = 0;
          if (parsedResult?.diagnostics) {
            parsedResult.diagnostics = {
              ...parsedResult.diagnostics,
              context_retry_used: false,
              context_prior_count: context.prior_count,
              context_merchant_hint: context.merchant_hint,
            };
          }
        }
      } else {
        contextRetrySkippedReason = context.prior_count <= 0
          ? 'no_priors'
          : 'low_value_priors';
      }
    } else {
      contextRetrySkippedReason = merchantHint ? 'not_eligible' : 'no_merchant_hint';
    }
    const finalOutcome = summarizeReceiptOutcome(parsedResult);
    const outcomeComparison = compareReceiptOutcomes(firstPassOutcome, finalOutcome);
    const totalScanDurationMs = Date.now() - scanStartedAt;

    const parsed = parsedResult?.parsed || null;
    if (!parsed) {
      const failure = buildIngestFailure('receipt', parsedResult?.failureReason);
      await IngestAttemptLog.create({
        userId: user?.id || null,
        source: 'receipt',
        status: 'failed',
        failureReason: failure.reason_code,
        metadata: {
          ...(parsedResult?.diagnostics || { image_size: image_base64.length, raw_present: Boolean(parsedResult?.raw) }),
          ...outcomeComparison,
          context_retry_attempted: contextRetryAttempted,
          context_lookup_duration_ms: contextLookupDurationMs,
          context_retry_duration_ms: contextRetryDurationMs,
          initial_parse_duration_ms: initialParseDurationMs,
          total_scan_duration_ms: totalScanDurationMs,
          context_retry_skipped_reason: contextRetrySkippedReason,
        },
      });
      return res.status(422).json(failure);
    }

    const categories = await Category.findByHousehold(user?.household_id);
    const { category_id, source, confidence } = await assignCategory({
      merchant: parsed.merchant,
      description: parsed.description,
      householdId: user?.household_id,
      categories,
    });
    const matchedCat = categories.find(c => c.id === category_id);
    let matchedLocation = null;
    const locationQuery = [
      parsed.merchant,
      parsed.store_number ? `Store ${parsed.store_number}` : null,
      parsed.store_address,
    ].filter(Boolean).join(' ');

    if (locationQuery) {
      try {
        matchedLocation = await searchPlace(locationQuery);
      } catch {
        matchedLocation = null;
      }
    }

    const attempt = await IngestAttemptLog.create({
      userId: user?.id || null,
      source: 'receipt',
      status: parsed.parse_status === 'partial' ? 'partial' : 'parsed',
      parseStatus: parsed.parse_status,
      reviewFields: parsed.review_fields,
      metadata: {
        ...(parsedResult?.diagnostics || {}),
        ...outcomeComparison,
        context_retry_attempted: contextRetryAttempted,
        context_lookup_duration_ms: contextLookupDurationMs,
        context_retry_duration_ms: contextRetryDurationMs,
        initial_parse_duration_ms: initialParseDurationMs,
        total_scan_duration_ms: totalScanDurationMs,
        context_retry_skipped_reason: contextRetrySkippedReason,
        category_id,
        category_source: source,
        category_confidence: confidence,
      },
    });

    res.json({
      ...parsed,
      ingest_attempt_id: attempt?.id || null,
      parsed_payment_snapshot: buildParsedPaymentSnapshot(parsed),
      source: 'camera',
      category_id,
      category_name: matchedCat?.name || null,
      category_source: source,
      category_confidence: confidence,
      place_name: matchedLocation?.place_name || parsed.merchant || null,
      address: matchedLocation?.address || parsed.store_address || null,
      mapkit_stable_id: matchedLocation?.mapkit_stable_id || null,
    });
  } catch (err) { next(err); }
});

// Confirm expense → save to DB + update merchant mapping + run dedup
router.post('/confirm', async (req, res, next) => {
  let confirmUser = null;
  let confirmAttemptId = null;
  let confirmSource = null;
  async function markConfirmFailure(reason, error = null) {
    if (!confirmAttemptId || !confirmUser?.id) return;
    if (confirmSource && !['manual', 'camera', 'refund'].includes(confirmSource)) return;
    try {
      await IngestAttemptLog.markConfirmFailed(confirmAttemptId, confirmUser.id, { reason, error });
    } catch (logErr) {
      console.error('Confirm ingest log failure (non-fatal):', logErr.message);
    }
  }

  try {
    const { merchant, description, amount, date, category_id, source, notes,
            place_name, address,
            mapkit_stable_id, linked_expense_id,
            payment_method, card_last4, card_label, is_private, exclude_from_budget, budget_exclusion_reason, items,
            ingest_attempt_id, parsed_payment_snapshot } = req.body;
    const originalParsedItems = Array.isArray(req.body.original_parsed_items) ? req.body.original_parsed_items : [];
    confirmAttemptId = ingest_attempt_id || null;
    confirmSource = source || null;

    const user = await getUser(req);
    confirmUser = user;
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });

    if (!amount || !date || !source) {
      await markConfirmFailure('missing_required_fields');
      return res.status(400).json({ error: 'amount, date, source required' });
    }

    if (Array.isArray(items) && items.some(it => !it.description || typeof it.description !== 'string' || it.description.trim() === '')) {
      await markConfirmFailure('invalid_items');
      return res.status(400).json({ error: 'Each item must have a non-empty description' });
    }

    if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
      await markConfirmFailure('invalid_category_id');
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }

    const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(budget_exclusion_reason);
    if (exclude_from_budget && !normalizedBudgetExclusionReason) {
      await markConfirmFailure('missing_budget_exclusion_reason');
      return res.status(400).json({ error: 'budget_exclusion_reason required when exclude_from_budget is true' });
    }

    const expense = await Expense.create({
      userId: user.id,
      householdId: user?.household_id,
      merchant, description, amount, date,
      categoryId: category_id,
      source,
      status: 'confirmed',
      notes,
      placeName: place_name,
      address,
      mapkitStableId: mapkit_stable_id,
      linkedExpenseId: linked_expense_id,
      paymentMethod: payment_method,
      cardLast4: card_last4,
      cardLabel: card_label,
      isPrivate: is_private ?? false,
      excludeFromBudget: exclude_from_budget ?? false,
      budgetExclusionReason: exclude_from_budget ? normalizedBudgetExclusionReason : null,
    });

    if (Array.isArray(items) && items.length > 0) {
      const resolvedItems = await Promise.all(
        items.map((item) => enrichItemWithResolution(item, merchant))
      );
      await ExpenseItem.createBulk(expense.id, resolvedItems);
      if (source === 'camera') {
        await captureReceiptLineCorrections({
          householdId: user?.household_id,
          merchant,
          originalItems: originalParsedItems,
          resolvedItems,
        });
      }
    }

    if (['manual', 'camera', 'refund'].includes(source) && ingest_attempt_id) {
      try {
        await IngestAttemptLog.appendPaymentFeedback(ingest_attempt_id, user.id, {
          originalPaymentMethod: parsed_payment_snapshot?.payment_method || null,
          originalCardLabel: parsed_payment_snapshot?.card_label || null,
          originalCardLast4: parsed_payment_snapshot?.card_last4 || null,
          finalPaymentMethod: payment_method || null,
          finalCardLabel: card_label || null,
          finalCardLast4: card_last4 || null,
        });
        await IngestAttemptLog.markConfirmed(ingest_attempt_id, user.id, { expenseId: expense.id });
      } catch (logErr) {
        console.error('Confirm ingest log update failed (non-fatal):', logErr.message);
      }
    }

    // Update merchant memory
    if (category_id && user?.household_id && `${merchant || ''}`.trim()) {
      await MerchantMapping.upsert({
        householdId: user.household_id,
        merchantName: merchant,
        categoryId: category_id,
      });
    }

    // Run dedup (non-fatal)
    let duplicate_flags = [];
    try {
      const expenseDate = expense.date instanceof Date
        ? expense.date.toISOString().split('T')[0]
        : expense.date;
      duplicate_flags = await detectDuplicates({
        id: expense.id,
        householdId: expense.household_id,
        merchant: expense.merchant,
        amount: expense.amount,
        date: expenseDate,
        mapkit_stable_id: expense.mapkit_stable_id,
      });
    } catch (dupErr) {
      console.error('Dedup error (non-fatal):', dupErr);
    }

    res.status(201).json({ expense, duplicate_flags });
  } catch (err) {
    await markConfirmFailure('server_error', err.message);
    next(err);
  }
});

// List confirmed expenses for the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const { month, category_id: categoryId } = req.query;
    const startDay = parseStartDay(req.query.start_day, user.budget_start_day || 1);
    if (startDay === null) return res.status(400).json({ error: 'start_day must be between 1 and 28' });
    if (categoryId !== undefined && categoryId !== null && categoryId !== '' && categoryId !== 'uncategorized' && !UUID_RE.test(categoryId)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }
    const expenses = await Expense.findByUser(user.id, { month, startDay, categoryId: categoryId || null });
    res.json(expenses);
  } catch (err) { next(err); }
});

// List all non-dismissed expenses for the user's household (falls back to personal if no household)
router.get('/household', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const { month, category_id: categoryId } = req.query;
    const household = user.household_id ? await Household.findById(user.household_id) : null;
    const startDay = parseStartDay(req.query.start_day, household?.budget_start_day || user.budget_start_day || 1);
    if (startDay === null) return res.status(400).json({ error: 'start_day must be between 1 and 28' });
    if (categoryId !== undefined && categoryId !== null && categoryId !== '' && categoryId !== 'uncategorized' && !UUID_RE.test(categoryId)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }
    const expenses = user.household_id
      ? await Expense.findByHousehold(user.household_id, { userId: user.id, month, startDay, categoryId: categoryId || null })
      : await Expense.findByUser(user.id, { month, startDay, categoryId: categoryId || null });
    res.json(expenses);
  } catch (err) { next(err); }
});

// List pending expenses for the authenticated user
router.get('/pending', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const baseExpenses = await fetchPendingExpensesBase(user.id);
    res.json(await attachExpensesReviewContext(baseExpenses, user.id));
  } catch (err) { next(err); }
});

// List distinct cards previously used by the user
router.get('/cards', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const result = await db.query(
      `SELECT card_label, card_last4, payment_method, MAX(created_at) AS last_used
       FROM expenses
       WHERE user_id = $1
         AND payment_method IN ('credit', 'debit')
         AND (card_last4 IS NOT NULL OR card_label IS NOT NULL)
       GROUP BY card_label, card_last4, payment_method
       ORDER BY MAX(created_at) DESC
       LIMIT 10`,
      [user.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.patch('/cards/rename', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const {
      payment_method,
      card_label,
      card_last4,
      next_card_label,
      next_card_last4,
    } = req.body || {};
    if (!['credit', 'debit'].includes(payment_method)) {
      return res.status(400).json({ error: 'payment_method must be credit or debit' });
    }
    if (!next_card_label && !next_card_last4) {
      return res.status(400).json({ error: 'next card details required' });
    }
    const result = await db.query(
      `UPDATE expenses
       SET card_label = $5,
           card_last4 = $6
       WHERE user_id = $1
         AND payment_method = $2
         AND COALESCE(card_label, '') = COALESCE($3, '')
         AND COALESCE(card_last4, '') = COALESCE($4, '')
       RETURNING id`,
      [
        user.id,
        payment_method,
        card_label || null,
        card_last4 || null,
        next_card_label || null,
        next_card_last4 || null,
      ]
    );
    res.json({ updated: result.rowCount || 0 });
  } catch (err) { next(err); }
});

router.post('/cards/forget', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const { payment_method, card_label, card_last4 } = req.body || {};
    if (!['credit', 'debit'].includes(payment_method)) {
      return res.status(400).json({ error: 'payment_method must be credit or debit' });
    }
    const result = await db.query(
      `UPDATE expenses
       SET card_label = NULL,
           card_last4 = NULL
       WHERE user_id = $1
         AND payment_method = $2
         AND COALESCE(card_label, '') = COALESCE($3, '')
         AND COALESCE(card_last4, '') = COALESCE($4, '')
       RETURNING id`,
      [user.id, payment_method, card_label || null, card_last4 || null]
    );
    res.json({ removed: result.rowCount || 0 });
  } catch (err) { next(err); }
});

// Dismiss a pending expense
router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const expense = await Expense.updateStatus(req.params.id, user.id, 'dismissed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.source === 'email') {
      const dismissalReasonField = normalizeDismissalReason(req.body?.dismissal_reason);
      await Expense.updateReviewMetadata(expense.id, user.id, { reviewRequired: false }) || expense;
      await EmailImportLog.recordReviewFeedback(expense.id, {
        action: 'dismissed',
        changedFields: dismissalReasonField ? [dismissalReasonField] : [],
      });
    }
    res.json(expense);
  } catch (err) { next(err); }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    let expense = await Expense.updateStatus(req.params.id, user.id, 'confirmed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.source === 'email') {
      const normalizedNotes = normalizeApprovedEmailNotes(expense.notes || '');
      if (normalizedNotes && normalizedNotes !== expense.notes) {
        try {
          expense = await Expense.update(req.params.id, user.id, { notes: normalizedNotes }) || expense;
        } catch (err) {
          console.error('[expenses/approve] note normalization update failed:', {
            expense_id: expense.id,
            message: err?.message || String(err || 'unknown_error'),
          });
        }
      }
      try {
        expense = await Expense.updateReviewMetadata(expense.id, user.id, { reviewRequired: false }) || expense;
      } catch (err) {
        console.error('[expenses/approve] review metadata update failed:', {
          expense_id: expense.id,
          message: err?.message || String(err || 'unknown_error'),
        });
      }
      const reviewContextField = normalizeReviewContext(req.body?.review_context);
      try {
        await EmailImportLog.recordReviewFeedback(expense.id, {
          action: 'approved',
          changedFields: reviewContextField ? [reviewContextField] : [],
        });
      } catch (err) {
        console.error('[expenses/approve] email review feedback failed:', {
          expense_id: expense.id,
          message: err?.message || String(err || 'unknown_error'),
        });
      }
    }
    try {
      res.json(await attachGmailReviewHint(expense, user.id));
    } catch (err) {
      console.error('[expenses/approve] gmail hint attach failed:', {
        expense_id: expense.id,
        message: err?.message || String(err || 'unknown_error'),
      });
      res.json({ ...expense, gmail_review_hint: null });
    }
  } catch (err) { next(err); }
});

// Delete an expense
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!canDeleteExpense(user, expense)) return res.status(404).json({ error: 'Expense not found' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE expenses SET linked_expense_id = NULL WHERE linked_expense_id = $1`, [req.params.id]);
      await client.query(`UPDATE email_import_log SET expense_id = NULL WHERE expense_id = $1`, [req.params.id]);
      await client.query(`DELETE FROM duplicate_flags WHERE expense_id_a = $1 OR expense_id_b = $1`, [req.params.id]);
      await client.query(`DELETE FROM expense_items WHERE expense_id = $1`, [req.params.id]);
      await client.query(`DELETE FROM recurring_preferences WHERE expense_id = $1`, [req.params.id]);
      await client.query(
        `DELETE FROM expenses WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// Get a single expense by ID with duplicate_flags
router.get('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!canViewExpense(user, expense)) return res.status(404).json({ error: 'Expense not found' });
    res.json(await attachExpenseReviewContext(expense, user.id, { includeItems: true }));
  } catch (err) { next(err); }
});

// Update an expense
router.patch('/:id', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, notes,
            payment_method, card_last4, card_label, is_private, exclude_from_budget, budget_exclusion_reason, items,
            place_name, address, mapkit_stable_id } = req.body;
    if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }
    if (items !== undefined) {
      const itemList = Array.isArray(items) ? items : [];
      if (itemList.some(it => !it.description || typeof it.description !== 'string' || it.description.trim() === '')) {
        return res.status(400).json({ error: 'Each item must have a non-empty description' });
      }
    }
    const normalizedBudgetExclusionReason = normalizeBudgetExclusionReason(budget_exclusion_reason);
    if (exclude_from_budget === true && !normalizedBudgetExclusionReason) {
      return res.status(400).json({ error: 'budget_exclusion_reason required when exclude_from_budget is true' });
    }
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const originalExpense = await Expense.findById(req.params.id);
    if (!originalExpense || originalExpense.user_id !== user.id) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    const originalItems = originalExpense.source === 'email' && items !== undefined
      ? await ExpenseItem.findByExpenseId(req.params.id)
      : [];
    const changedFields = originalExpense.source === 'email'
      ? collectChangedFields(originalExpense, req.body)
      : [];
    if (originalExpense.source === 'email' && items !== undefined) {
      changedFields.push(...collectItemReviewSignals(originalItems, Array.isArray(items) ? items : []));
    }
    const expense = await Expense.update(req.params.id, user.id, {
      merchant,
      amount,
      date,
      categoryId: category_id,
      notes,
      paymentMethod: payment_method,
      cardLast4: card_last4,
      cardLabel: card_label,
      isPrivate: is_private,
      excludeFromBudget: exclude_from_budget,
      budgetExclusionReason: exclude_from_budget === false ? null : normalizedBudgetExclusionReason,
      placeName: place_name,
      address,
      mapkitStableId: mapkit_stable_id,
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (items !== undefined) {
      try {
        const resolvedItems = await Promise.all(
          (Array.isArray(items) ? items : []).map((item) =>
            enrichItemWithResolution(item, merchant ?? expense.merchant)
          )
        );
        await ExpenseItem.replaceItems(req.params.id, resolvedItems);
      } catch (err) {
        console.error('[expenses/:id PATCH] item replace failed:', {
          expense_id: req.params.id,
          message: err?.message || String(err || 'unknown_error'),
        });
      }
    }
    if (expense.source === 'email' && changedFields.length) {
      try {
        await EmailImportLog.recordReviewFeedback(expense.id, {
          action: 'edited',
          changedFields,
          incrementEditCount: true,
        });
      } catch (err) {
        console.error('[expenses/:id PATCH] email review feedback failed:', {
          expense_id: expense.id,
          message: err?.message || String(err || 'unknown_error'),
        });
      }
    }
    res.json(expense);
  } catch (err) { next(err); }
});

module.exports = router;
