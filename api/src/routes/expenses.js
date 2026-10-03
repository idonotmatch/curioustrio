const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Household = require('../models/household');
const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const CategoryDecisionEvent = require('../models/categoryDecisionEvent');
const { classifyExpenseItemType } = require('../services/itemClassifier');
const {
  createConfirmedExpense,
  enrichItemWithResolution,
  normalizeBudgetExclusionReason,
  updateMerchantMemory,
  validateConfirmExpensePayload,
} = require('../services/expenseConfirmService');
const {
  parseExpenseInput,
  scanReceiptInput,
} = require('../services/expenseIngestService');
const {
  handleApprovedExpenseReview,
  handleDismissedExpenseReview,
} = require('../services/expenseEmailReviewService');
const { requestProjectionRefresh } = require('../services/projectionRefreshService');
const { emitExpenseFreshnessEvent } = require('../services/freshnessEvents');
const { canDeleteExpense, canViewExpense } = require('../services/expenseAccessPolicy');
const {
  attachExpenseReviewContext,
  attachExpensesReviewContext,
  fetchPendingExpensesBase,
} = require('../services/expenseReviewContext');
const db = require('../db');
const { buildExpensePage, decodeExpenseCursor } = require('../services/expensePagination');
const { resolveDuplicate, undoDuplicateMerge } = require('../services/duplicateResolutionService');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
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

function normalizeReviewItem(item = {}, index = 0) {
  const amount = item.amount == null || item.amount === '' ? null : Number(item.amount);
  const quantity = item.quantity == null || item.quantity === '' ? null : Number(item.quantity);
  const unitPrice = item.unit_price == null || item.unit_price === '' ? null : Number(item.unit_price);
  return {
    description: `${item.description || ''}`.trim(),
    normalized_description: `${item.description || ''}`.trim().toLowerCase(),
    amount,
    quantity,
    unit_price: unitPrice,
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
  let quantityChanged = false;
  let unitPriceChanged = false;
  let typeChanged = false;
  for (let i = 0; i < compareLength; i += 1) {
    if (original[i].normalized_description !== next[i].normalized_description) descriptionChanged = true;
    if (`${original[i].amount ?? ''}` !== `${next[i].amount ?? ''}`) amountChanged = true;
    if (`${original[i].quantity ?? ''}` !== `${next[i].quantity ?? ''}`) quantityChanged = true;
    if (`${original[i].unit_price ?? ''}` !== `${next[i].unit_price ?? ''}`) unitPriceChanged = true;
    if (original[i].item_type !== next[i].item_type) typeChanged = true;
  }
  if (descriptionChanged) signals.push('items_description');
  if (amountChanged) signals.push('items_amount');
  if (quantityChanged) signals.push('items_quantity');
  if (unitPriceChanged) signals.push('items_unit_price');
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

const { aiEndpoints } = require('../middleware/rateLimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const result = await parseExpenseInput({
      userPromise: getUser(req),
      input,
      todayDate,
    });
    if (result.errorStatus) {
      return res.status(result.errorStatus).json(result.errorBody);
    }
    res.json(result.body);
  } catch (err) { next(err); }
});

// Scan receipt image → structured expense (does NOT save to DB)
router.post('/scan', aiEndpoints, async (req, res, next) => {
  try {
    const { image_base64, today } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
    if (image_base64.length > 3_000_000) return res.status(400).json({ error: 'image too large (max ~2MB)' });

    const result = await scanReceiptInput({
      user: await getUser(req),
      imageBase64: image_base64,
      todayDate: today || new Date().toISOString().split('T')[0],
    });
    if (result.errorStatus) {
      return res.status(result.errorStatus).json(result.errorBody);
    }
    res.json(result.body);
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
    const {
      merchant, description, amount, date, category_id, source, notes,
      place_name, address,
      mapkit_stable_id, linked_expense_id,
      location_provider_id, location_latitude, location_longitude, location_source, location_confidence,
      suggested_category_id, category_source, category_confidence, category_reasoning,
      category_status, location_status, category_user_owned, location_user_owned,
      payment_method, card_last4, card_label, is_private, exclude_from_budget, budget_exclusion_reason, items,
      ingest_attempt_id, parsed_payment_snapshot, idempotency_key, receipt_details,
    } = req.body;
    const originalParsedItems = Array.isArray(req.body.original_parsed_items) ? req.body.original_parsed_items : [];
    confirmAttemptId = ingest_attempt_id || null;
    confirmSource = source || null;

    const user = await getUser(req);
    confirmUser = user;
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });

    const validation = validateConfirmExpensePayload(req.body);
    if (validation.error) {
      await markConfirmFailure(validation.reason);
      return res.status(400).json({ error: validation.error });
    }

    const { expense, duplicate_flags, idempotent_replay: idempotentReplay = false } = await createConfirmedExpense({
      user,
      payload: {
        merchant,
        description,
        amount,
        date,
        category_id,
        suggested_category_id,
        source,
        notes,
        place_name,
        address,
        mapkit_stable_id,
        location_provider_id,
        location_latitude,
        location_longitude,
        location_source,
        location_confidence,
        linked_expense_id,
        category_source,
        category_confidence,
        category_reasoning,
        category_status,
        location_status,
        category_user_owned,
        location_user_owned,
        payment_method,
        card_last4,
        card_label,
        is_private,
        exclude_from_budget,
        budget_exclusion_reason,
        items,
        ingest_attempt_id,
        parsed_payment_snapshot,
        receipt_details,
        idempotency_key,
      },
      originalParsedItems,
    });
    if (!idempotentReplay) {
      requestProjectionRefresh({
        user,
        reason: 'expense_confirmed',
        expense,
        metadata: { source: source || 'manual' },
      });
      await emitExpenseFreshnessEvent(user, expense, {
        eventType: 'expense_confirmed',
        metadata: { source: source || 'manual' },
      });
    }

    res.status(idempotentReplay ? 200 : 201).json({ expense, duplicate_flags, idempotent_replay: idempotentReplay });
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
    const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
    const pageSize = Math.max(1, Math.min(Number(req.query.limit) || 25, 50));
    const cursor = req.query.cursor ? decodeExpenseCursor(req.query.cursor) : null;
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'cursor is invalid' });
    const expenses = await Expense.findByUser(user.id, {
      month,
      startDay,
      categoryId: categoryId || null,
      ...(paginated ? { limit: pageSize + 1, cursor } : {}),
    });
    res.json(paginated ? buildExpensePage(expenses, pageSize) : expenses);
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
    const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
    const pageSize = Math.max(1, Math.min(Number(req.query.limit) || 25, 50));
    const cursor = req.query.cursor ? decodeExpenseCursor(req.query.cursor) : null;
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'cursor is invalid' });
    const pagination = paginated ? { limit: pageSize + 1, cursor } : {};
    const expenses = user.household_id
      ? await Expense.findByHousehold(user.household_id, { userId: user.id, month, startDay, categoryId: categoryId || null, ...pagination })
      : await Expense.findByUser(user.id, { month, startDay, categoryId: categoryId || null, ...pagination });
    res.json(paginated ? buildExpensePage(expenses, pageSize) : expenses);
  } catch (err) { next(err); }
});

// List pending expenses for the authenticated user
router.get('/pending/count', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM expenses
       WHERE user_id = $1 AND status = 'pending'`,
      [user.id]
    );
    res.json({ count: Number(result.rows[0]?.count || 0) });
  } catch (err) { next(err); }
});

router.get('/pending', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const paginated = req.query.paginated === '1' || req.query.paginated === 'true';
    const pageSize = Math.max(1, Math.min(Number(req.query.limit) || 25, 50));
    const cursor = req.query.cursor ? decodeExpenseCursor(req.query.cursor) : null;
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'cursor is invalid' });
    const baseExpenses = await fetchPendingExpensesBase(user.id, paginated ? { limit: pageSize + 1, cursor } : {});
    if (!paginated) return res.json(await attachExpensesReviewContext(baseExpenses, user.id, { compact: true }));
    const page = buildExpensePage(baseExpenses, pageSize);
    const items = await attachExpensesReviewContext(page.items, user.id, { compact: true });
    res.json({ items, next_cursor: page.next_cursor });
  } catch (err) { next(err); }
});

router.post('/pending/batch', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const action = `${req.body?.action || ''}`;
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id) => `${id}`.trim()))];
    if (!['approve', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action must be approve or dismiss' });
    if (!ids.length || ids.length > 50 || ids.some((id) => !UUID_RE.test(id))) {
      return res.status(400).json({ error: 'ids must contain between 1 and 50 valid expense ids' });
    }
    const dismissalReason = action === 'dismiss' ? `${req.body?.dismissal_reason || ''}`.trim() : null;
    const reviewContexts = req.body?.review_contexts && typeof req.body.review_contexts === 'object'
      ? req.body.review_contexts
      : {};
    if (action === 'dismiss' && !dismissalReason) return res.status(400).json({ error: 'dismissal_reason is required' });

    const result = await db.query(
      `UPDATE expenses e
       SET status = $3
       WHERE e.user_id = $1
         AND e.id = ANY($2::uuid[])
         AND e.status = 'pending'
         AND ($3 <> 'confirmed' OR NOT EXISTS (
           SELECT 1 FROM duplicate_flags f
           WHERE f.status = 'pending' AND (f.expense_id_a = e.id OR f.expense_id_b = e.id)
         ))
       RETURNING e.*`,
      [user.id, ids, action === 'approve' ? 'confirmed' : 'dismissed']
    );
    const reviewed = await Promise.all(result.rows.map(async (expense) => {
      try {
        if (action === 'approve') {
          const context = ['quick_check', 'full_review'].includes(reviewContexts[expense.id])
            ? reviewContexts[expense.id]
            : 'full_review';
          return await handleApprovedExpenseReview(expense, user.id, context);
        }
        return await handleDismissedExpenseReview(expense, user.id, dismissalReason);
      } catch (reviewErr) {
        console.error('[expenses/pending/batch] review feedback failed:', {
          expense_id: expense.id,
          action,
          message: reviewErr?.message || String(reviewErr || 'unknown_error'),
        });
        return expense;
      }
    }));
    const processedIds = reviewed.map((expense) => expense.id);
    const failedIds = ids.filter((id) => !processedIds.includes(id));
    if (action === 'approve' && reviewed[0]) {
      requestProjectionRefresh({
        user,
        reason: 'pending_expense_batch_approved',
        expense: reviewed[0],
        metadata: { count: reviewed.length, source: 'batch_review' },
      });
    }
    if (reviewed[0]) {
      await emitExpenseFreshnessEvent(user, reviewed[0], {
        eventType: action === 'approve' ? 'pending_expense_batch_approved' : 'pending_expense_batch_dismissed',
        includePending: true,
        includeGmail: true,
        metadata: { count: reviewed.length, source: 'batch_review' },
      });
    }
    res.json({
      action,
      processed_ids: processedIds,
      failed_ids: failedIds,
      processed_count: processedIds.length,
    });
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
    let expense = await Expense.updateStatus(req.params.id, user.id, 'dismissed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    expense = await handleDismissedExpenseReview(expense, user.id, req.body?.dismissal_reason);
    await emitExpenseFreshnessEvent(user, expense, {
      eventType: 'pending_expense_dismissed',
      includePending: true,
      includeGmail: expense?.source === 'email',
      metadata: { source: expense?.source || null },
    });
    res.json(await attachExpenseReviewContext(expense, user.id, {
      includeItems: true,
      includeCategoryReasoning: true,
    }));
  } catch (err) { next(err); }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    let expense = await Expense.updateStatus(req.params.id, user.id, 'confirmed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    expense = await handleApprovedExpenseReview(expense, user.id, req.body?.review_context);
    requestProjectionRefresh({
      user,
      reason: 'expense_review_approved',
      expense,
      metadata: { source: 'gmail_review' },
    });
    await emitExpenseFreshnessEvent(user, expense, {
      eventType: 'pending_expense_approved',
      includePending: true,
      includeGmail: expense?.source === 'email',
      metadata: { source: 'gmail_review' },
    });
    res.json(expense);
  } catch (err) { next(err); }
});

router.post('/:id/duplicates/:flagId/resolve', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.flagId)) {
      return res.status(400).json({ error: 'Invalid expense or duplicate flag id' });
    }
    const result = await resolveDuplicate({
      user,
      expenseId: req.params.id,
      flagId: req.params.flagId,
      action: req.body?.action,
    });
    if (!result.idempotent_replay) {
      requestProjectionRefresh({
        user,
        reason: 'duplicate_resolved',
        expense: result.expense,
        metadata: { action: result.action, duplicate_flag_id: req.params.flagId },
      });
      await emitExpenseFreshnessEvent(user, result.expense, {
        eventType: 'duplicate_resolved',
        includePending: true,
        includeGmail: true,
        metadata: { action: result.action, duplicate_flag_id: req.params.flagId },
      });
    }
    res.json({
      ...result,
      expense: await attachExpenseReviewContext(result.expense, user.id, {
        includeItems: true,
        includeCategoryReasoning: true,
      }),
    });
  } catch (err) { next(err); }
});

router.post('/merges/:mergeEventId/undo', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    if (!UUID_RE.test(req.params.mergeEventId)) return res.status(400).json({ error: 'Invalid merge event id' });
    const result = await undoDuplicateMerge({ user, mergeEventId: req.params.mergeEventId });
    await emitExpenseFreshnessEvent(user, { id: result.restored_expense_id, user_id: user.id }, {
      eventType: 'duplicate_merge_undone',
      includePending: true,
      includeGmail: true,
      metadata: { merge_event_id: req.params.mergeEventId },
    });
    res.json(result);
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
    requestProjectionRefresh({
      user,
      reason: 'expense_deleted',
      expense,
      metadata: { source: 'expense_delete' },
    });
    await emitExpenseFreshnessEvent(user, expense, {
      eventType: 'expense_deleted',
      metadata: { source: 'expense_delete' },
    });
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
    res.json(await attachExpenseReviewContext(expense, user.id, {
      includeItems: true,
      includeCategoryReasoning: true,
    }));
  } catch (err) { next(err); }
});

// Update an expense
router.patch('/:id', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, notes,
            payment_method, card_last4, card_label, is_private, exclude_from_budget, budget_exclusion_reason, items,
            place_name, address, mapkit_stable_id,
            location_provider_id, location_latitude, location_longitude, location_source,
            location_status, location_confidence, location_user_owned } = req.body;
    if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }
    if (items !== undefined) {
      const itemList = Array.isArray(items) ? items : [];
      if (itemList.some(it => !it.description || typeof it.description !== 'string' || it.description.trim() === '')) {
        return res.status(400).json({ error: 'Each item must have a non-empty description' });
      }
    }
    if (location_latitude != null && (!Number.isFinite(Number(location_latitude)) || Number(location_latitude) < -90 || Number(location_latitude) > 90)) {
      return res.status(400).json({ error: 'location_latitude must be between -90 and 90' });
    }
    if (location_longitude != null && (!Number.isFinite(Number(location_longitude)) || Number(location_longitude) < -180 || Number(location_longitude) > 180)) {
      return res.status(400).json({ error: 'location_longitude must be between -180 and 180' });
    }
    if (location_confidence != null && (!Number.isFinite(Number(location_confidence)) || Number(location_confidence) < 0 || Number(location_confidence) > 1)) {
      return res.status(400).json({ error: 'location_confidence must be between 0 and 1' });
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
      categorySource: category_id !== undefined ? 'manual_edit' : undefined,
      categoryConfidence: category_id !== undefined ? null : undefined,
      categoryReasoning: category_id !== undefined ? {
        strategy: 'manual_edit',
        label: 'Updated manually',
        detail: 'This category was changed directly by the user.',
      } : undefined,
      placeName: place_name,
      address,
      mapkitStableId: mapkit_stable_id,
      locationProviderId: location_provider_id,
      locationLatitude: location_latitude,
      locationLongitude: location_longitude,
      locationSource: location_source,
      locationStatus: location_status,
      locationConfidence: location_confidence,
      locationUserOwned: location_user_owned,
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const categoryChanged = category_id !== undefined && `${originalExpense.category_id || ''}` !== `${expense.category_id || ''}`;
    const merchantChanged = merchant !== undefined && `${originalExpense.merchant || ''}` !== `${expense.merchant || ''}`;
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
    if ((categoryChanged || merchantChanged) && expense.category_id) {
      try {
        await updateMerchantMemory({
          categoryId: expense.category_id,
          householdId: user?.household_id,
          merchant: expense.merchant,
        });
        await CategoryDecisionEvent.create({
          userId: user.id,
          householdId: user?.household_id || null,
          expenseId: expense.id,
          eventType: 'edit',
          merchantName: expense.merchant || null,
          description: expense.description || null,
          suggestedCategoryId: originalExpense.category_id || null,
          previousCategoryId: originalExpense.category_id || null,
          finalCategoryId: expense.category_id || null,
          suggestionSource: 'manual_edit',
          suggestionConfidence: null,
        });
      } catch (categoryDecisionErr) {
        console.error('[expenses/:id PATCH] category learning update failed:', {
          expense_id: expense.id,
          message: categoryDecisionErr?.message || String(categoryDecisionErr || 'unknown_error'),
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
    if (collectChangedFields(originalExpense, req.body).some((field) => [
      'amount',
      'date',
      'category_id',
      'merchant',
      'is_private',
      'exclude_from_budget',
      'budget_exclusion_reason',
    ].includes(field))) {
      requestProjectionRefresh({
        user,
        reason: 'expense_updated',
        expense,
        categoryId: expense.category_id,
        merchant: expense.merchant,
        metadata: {
          source: 'expense_edit',
          changed_fields: collectChangedFields(originalExpense, req.body),
        },
      });
    }
    await emitExpenseFreshnessEvent(user, expense, {
      eventType: 'expense_updated',
      metadata: {
        changed_fields: collectChangedFields(originalExpense, req.body),
      },
    });
    res.json(expense);
  } catch (err) { next(err); }
});

module.exports = router;
