const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseItem = require('../models/expenseItem');
const { parseExpense } = require('../services/nlParser');
const { parseReceipt } = require('../services/receiptParser');
const { assignCategory } = require('../services/categoryAssigner');
const detectDuplicates = require('../services/duplicateDetector');
const db = require('../db');

router.use(authenticate);

async function getUser(req) {
  return User.findByAuth0Id(req.auth0Id);
}

const { aiEndpoints } = require('../middleware/rateLimit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parse NL input → structured expense (does NOT save to DB)
router.post('/parse', aiEndpoints, async (req, res, next) => {
  try {
    const { input, today } = req.body;
    if (!input) return res.status(400).json({ error: 'input required' });

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

    res.json({ ...parsed, category_id, category_source: source, category_confidence: confidence });
  } catch (err) { next(err); }
});

// Scan receipt image → structured expense (does NOT save to DB)
router.post('/scan', aiEndpoints, async (req, res, next) => {
  try {
    const { image_base64, today } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

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

    res.json({ ...parsed, source: 'camera', category_id, category_source: source, category_confidence: confidence });
  } catch (err) { next(err); }
});

// Confirm expense → save to DB + update merchant mapping + run dedup
router.post('/confirm', async (req, res, next) => {
  try {
    const { merchant, description, amount, date, category_id, source, notes,
            place_name, address, mapkit_stable_id, linked_expense_id,
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
      await ExpenseItem.createBulk(expense.id, items);
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
    const expenses = await Expense.findByUser(user.id);
    res.json(expenses);
  } catch (err) { next(err); }
});

// List all non-dismissed expenses for the user's household (falls back to personal if no household)
router.get('/household', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const expenses = user.household_id
      ? await Expense.findByHousehold(user.household_id, { userId: user.id })
      : await Expense.findByUser(user.id);
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
    res.json(expenses);
  } catch (err) { next(err); }
});

// Dismiss a pending expense
router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const expense = await Expense.updateStatus(req.params.id, user.id, 'dismissed');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) { next(err); }
});

// Delete an expense
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByAuth0Id(req.auth0Id);
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const ownedByUser = expense.user_id === user?.id;
    const ownedByHousehold = user?.household_id && expense.household_id === user.household_id;
    if (!ownedByUser && !ownedByHousehold) return res.status(404).json({ error: 'Expense not found' });
    await db.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
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
    res.json({ ...expense, duplicate_flags, items });
  } catch (err) { next(err); }
});

// Update an expense
router.patch('/:id', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, notes,
            payment_method, card_last4, card_label, is_private, items } = req.body;
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
    const expense = await Expense.update(req.params.id, user.id, { merchant, amount, date, categoryId: category_id, notes, paymentMethod: payment_method, cardLast4: card_last4, cardLabel: card_label, isPrivate: is_private });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (items !== undefined) {
      await ExpenseItem.replaceItems(req.params.id, Array.isArray(items) ? items : []);
    }
    res.json(expense);
  } catch (err) { next(err); }
});

module.exports = router;
