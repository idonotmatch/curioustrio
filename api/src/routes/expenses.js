const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Household = require('../models/household');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const { getSenderImportQuality } = require('../services/gmailImportQualityService');
const { classifyExpenseItemType } = require('../services/itemClassifier');
const { parseExpense } = require('../services/nlParser');
const { parseReceipt } = require('../services/receiptParser');
const { assignCategory } = require('../services/categoryAssigner');
const detectDuplicates = require('../services/duplicateDetector');
const { resolveProduct } = require('../services/productResolver');
const { searchPlace } = require('../services/mapkitService');
const db = require('../db');

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

function deriveEmailFieldEvidence(expense, log) {
  if (!expense || !log?.message_id) return {};

  const subject = `${log.subject || ''}`;
  const fromAddress = `${log.from_address || ''}`;
  const merchant = `${expense.merchant || ''}`.trim();
  const amount = Math.abs(Number(expense.amount || 0));
  const importedDate = log.imported_at ? new Date(log.imported_at).toISOString().slice(0, 10) : null;

  let merchantEvidence = null;
  if (merchant) {
    const merchantPattern = merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(merchantPattern, 'i').test(subject)) {
      merchantEvidence = 'Merchant matched from the email subject.';
    } else if (fromAddress.toLowerCase().includes(merchant.toLowerCase().replace(/\s+/g, ''))) {
      merchantEvidence = 'Merchant matched from the sender address.';
    } else if (fromAddress) {
      merchantEvidence = 'Merchant was inferred from the sender and email context.';
    }
  }

  let amountEvidence = null;
  if (amount > 0) {
    const amountPattern = amount.toFixed(2).replace('.', '\\.');
    const text = `${subject} ${expense.notes || ''}`;
    if (new RegExp(`\\$\\s?${amountPattern}\\b`).test(text)) {
      amountEvidence = 'Amount matched a total called out in the email.';
    } else if (Array.isArray(expense.items) && expense.items.length > 0) {
      amountEvidence = `Amount was checked against ${expense.items.length} extracted ${expense.items.length === 1 ? 'line item' : 'line items'}.`;
    } else {
      amountEvidence = 'Amount was extracted from the email purchase summary.';
    }
  }

  let dateEvidence = null;
  if (expense.date && importedDate && expense.date.slice(0, 10) === importedDate) {
    dateEvidence = 'Date is based on when the email was received.';
  } else if (expense.date) {
    dateEvidence = 'Date was extracted from the email timing details.';
  }

  return {
    merchant_evidence: merchantEvidence,
    amount_evidence: amountEvidence,
    date_evidence: dateEvidence,
  };
}

function buildEmailReviewHint(expense, log, senderQuality) {
  if (!log?.message_id) return null;

  const level = senderQuality?.level || 'unknown';
  const likelyChangedFields = Array.isArray(senderQuality?.top_changed_fields)
    ? senderQuality.top_changed_fields.map((entry) => entry.field).filter(Boolean)
    : [];
  const fieldEvidence = deriveEmailFieldEvidence(expense, log);

  let headline = 'Imported from Gmail';
  let tone = 'info';
  let message = 'Review the details before approving this import.';

  if (log.review_action === 'approved') {
    return {
      sender_domain: senderQuality?.sender_domain || null,
      from_address: log.from_address || null,
      imported_at: log.imported_at || null,
      sender_quality_level: level,
      sender_quality_metrics: senderQuality?.metrics || null,
      likely_changed_fields: likelyChangedFields,
      message_subject: log.subject || null,
      ...fieldEvidence,
      headline: 'Reviewed Gmail import',
      tone: 'positive',
      message: log.review_edit_count > 0
        ? 'This Gmail import was reviewed and updated before it was confirmed.'
        : 'This Gmail import was reviewed before it was confirmed.',
    };
  }

  if (level === 'trusted') {
    tone = 'positive';
    headline = 'Trusted sender';
    message = 'This sender is usually accurate. A quick check is probably enough.';
  } else if (level === 'noisy') {
    tone = 'warning';
    headline = 'Low-confidence sender';
    message = 'Imports from this sender often need edits or get dismissed, so review carefully.';
  } else if (level === 'mixed') {
    tone = 'caution';
    headline = 'Mixed sender history';
    message = 'Imports from this sender are sometimes right and sometimes need correction.';
  }

  return {
    sender_domain: senderQuality?.sender_domain || null,
    from_address: log.from_address || null,
    imported_at: log.imported_at || null,
    sender_quality_level: level,
    sender_quality_metrics: senderQuality?.metrics || null,
    likely_changed_fields: likelyChangedFields,
    message_subject: log.subject || null,
    ...fieldEvidence,
    headline,
    tone,
    message,
  };
}

function normalizeApprovedEmailNotes(notes = '') {
  if (!notes) return notes;
  return `${notes}`
    .replace(/\(\s*needs review\s*\)/ig, '(imported from Gmail)')
    .replace(/\bneeds review\b/ig, 'imported from Gmail')
    .trim();
}

async function attachGmailReviewHint(expense, userId) {
  if (!expense || expense.source !== 'email') return expense;
  const log = await EmailImportLog.findByExpenseId(expense.id);
  if (!log?.from_address) {
    return { ...expense, gmail_review_hint: null };
  }
  const senderQuality = await getSenderImportQuality(userId, log.from_address);
  return {
    ...expense,
    gmail_review_hint: buildEmailReviewHint(expense, log, senderQuality),
  };
}

async function attachGmailReviewHints(expenses = [], userId) {
  return Promise.all(expenses.map((expense) => attachGmailReviewHint(expense, userId)));
}

const { aiEndpoints } = require('../middleware/rateLimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse NL input → structured expense (does NOT save to DB)
router.post('/parse', aiEndpoints, async (req, res, next) => {
  try {
    const { input, today } = req.body;
    if (!input) return res.status(400).json({ error: 'input required' });
    if (input.length > 500) return res.status(400).json({ error: 'input too long (max 500 characters)' });

    const parsed = await parseExpense(input, today || new Date().toISOString().split('T')[0]);
    if (!parsed) return res.status(422).json({ error: 'Could not parse expense' });

    const user = await getUser(req);
    const categories = await Category.findByHousehold(user?.household_id);
    const { category_id, source, confidence } = await assignCategory({
      merchant: parsed.merchant,
      description: parsed.description,
      householdId: user?.household_id,
      categories,
    });
    const matchedCat = categories.find(c => c.id === category_id);

    res.json({ ...parsed, category_id, category_name: matchedCat?.name || null, category_source: source, category_confidence: confidence });
  } catch (err) { next(err); }
});

// Scan receipt image → structured expense (does NOT save to DB)
router.post('/scan', aiEndpoints, async (req, res, next) => {
  try {
    const { image_base64, today } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
    if (image_base64.length > 3_000_000) return res.status(400).json({ error: 'image too large (max ~2MB)' });

    const todayDate = today || new Date().toISOString().split('T')[0];
    const parsed = await parseReceipt(image_base64, todayDate);
    if (!parsed) return res.status(422).json({ error: 'Could not parse receipt' });

    const user = await getUser(req);
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

    res.json({
      ...parsed,
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
  try {
    const { merchant, description, amount, date, category_id, source, notes,
            place_name, address,
            mapkit_stable_id, linked_expense_id,
            payment_method, card_last4, card_label, is_private, items } = req.body;

    if (!amount || !date || !source) {
      return res.status(400).json({ error: 'amount, date, source required' });
    }

    if (Array.isArray(items) && items.some(it => !it.description || typeof it.description !== 'string' || it.description.trim() === '')) {
      return res.status(400).json({ error: 'Each item must have a non-empty description' });
    }

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });

    if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
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
    });

    if (Array.isArray(items) && items.length > 0) {
      const resolvedItems = await Promise.all(
        items.map(async (item) => {
          const product_id = await resolveProduct(item, merchant);
          return { ...item, product_id };
        })
      );
      await ExpenseItem.createBulk(expense.id, resolvedItems);
    }

    // Update merchant memory
    if (category_id && user?.household_id) {
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
  } catch (err) { next(err); }
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
    const result = await db.query(
      `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.user_id = $1 AND e.status = 'pending'
       ORDER BY e.date DESC, e.created_at DESC`,
      [user.id]
    );
    // For each expense, attach duplicate_flags
    const expenses = await Promise.all(
      result.rows.map(async (e) => ({
        ...e,
        duplicate_flags: await DuplicateFlag.findByExpenseId(e.id),
      }))
    );
    res.json(await attachGmailReviewHints(expenses, user.id));
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

// Dismiss a pending expense
router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const expense = await Expense.updateStatus(req.params.id, user.id, 'dismissed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.source === 'email') {
      await EmailImportLog.recordReviewFeedback(expense.id, { action: 'dismissed' });
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
        expense = await Expense.update(req.params.id, user.id, { notes: normalizedNotes }) || expense;
      }
      await EmailImportLog.recordReviewFeedback(expense.id, { action: 'approved' });
    }
    res.json(await attachGmailReviewHint(expense, user.id));
  } catch (err) { next(err); }
});

// Delete an expense
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const ownedByUser = expense.user_id === user?.id;
    const ownedByHousehold = user?.household_id && expense.household_id === user.household_id;
    if (!ownedByUser && !ownedByHousehold) return res.status(404).json({ error: 'Expense not found' });
    // Re-assert ownership in the DELETE itself to close the TOCTOU window.
    await db.query(
      `DELETE FROM expenses WHERE id = $1 AND (user_id = $2 OR household_id = $3)`,
      [req.params.id, user.id, user.household_id || null]
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// Get a single expense by ID with duplicate_flags
router.get('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    // Scope to user's household or own expenses
    const ownedByUser = expense.user_id === user?.id;
    const inHousehold = user?.household_id && expense.household_id === user.household_id;
    if (!ownedByUser && !inHousehold) return res.status(404).json({ error: 'Expense not found' });
    const duplicate_flags = await DuplicateFlag.findByExpenseId(expense.id);
    const items = await ExpenseItem.findByExpenseId(expense.id);
    res.json(await attachGmailReviewHint({ ...expense, duplicate_flags, items }, user.id));
  } catch (err) { next(err); }
});

// Update an expense
router.patch('/:id', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, notes,
            payment_method, card_last4, card_label, is_private, items,
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
      placeName: place_name,
      address,
      mapkitStableId: mapkit_stable_id,
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (items !== undefined) {
      await ExpenseItem.replaceItems(req.params.id, Array.isArray(items) ? items : []);
    }
    if (expense.source === 'email' && changedFields.length) {
      await EmailImportLog.recordReviewFeedback(expense.id, {
        action: 'edited',
        changedFields,
        incrementEditCount: true,
      });
    }
    res.json(expense);
  } catch (err) { next(err); }
});

module.exports = router;
