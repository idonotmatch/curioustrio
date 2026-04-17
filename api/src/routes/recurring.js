const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const RecurringExpense = require('../models/recurringExpense');
const RecurringPreference = require('../models/recurringPreference');
const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const {
  detectRecurring,
  detectRecurringItems,
  detectRecurringItemSignals,
  getRecurringItemHistory,
  detectRecurringWatchCandidates,
} = require('../services/recurringDetector');
const { findObservationOpportunities } = require('../services/priceObservationService');

router.use(authenticate);

async function getUser(req) { return User.findByProviderUid(req.userId); }

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const recurring = await RecurringExpense.findByHousehold(user.household_id);
    res.json(recurring);
  } catch (err) { next(err); }
});

router.post('/detect', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const candidates = await detectRecurring(user.household_id);
    res.json(candidates);
  } catch (err) { next(err); }
});

router.post('/detect-items', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const candidates = await detectRecurringItems(user.household_id);
    res.json(candidates);
  } catch (err) { next(err); }
});

router.post('/detect-item-signals', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const signals = await detectRecurringItemSignals(user.household_id);
    res.json(signals);
  } catch (err) { next(err); }
});

router.get('/item-history', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const groupKey = `${req.query.group_key || ''}`.trim();
    if (!groupKey) return res.status(400).json({ error: 'group_key is required' });
    const history = await getRecurringItemHistory(user.household_id, groupKey);
    if (!history) return res.status(404).json({ error: 'Recurring item history not found' });
    res.json(history);
  } catch (err) { next(err); }
});

router.get('/watch-candidates', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const windowDays = Math.max(1, Math.min(Number(req.query.window_days) || 5, 30));
    const candidates = await detectRecurringWatchCandidates(user.household_id, { windowDays });
    res.json(candidates);
  } catch (err) { next(err); }
});

router.get('/watch-opportunities', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const windowDays = Math.max(1, Math.min(Number(req.query.window_days) || 5, 30));
    const freshnessHours = Math.max(1, Math.min(Number(req.query.freshness_hours) || 72, 24 * 14));
    const opportunities = await findObservationOpportunities(user.household_id, {
      windowDays,
      freshnessHours,
    });
    res.json(opportunities);
  } catch (err) { next(err); }
});

router.get('/preferences', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const expenseId = `${req.query.expense_id || ''}`.trim();
    if (!expenseId) return res.status(400).json({ error: 'expense_id is required' });
    const preference = await RecurringPreference.findByExpenseId(user.id, expenseId);
    res.json(preference || null);
  } catch (err) { next(err); }
});

router.post('/preferences', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const expenseId = `${req.body?.expense_id || ''}`.trim();
    const expectedFrequencyDays = req.body?.expected_frequency_days == null || req.body?.expected_frequency_days === ''
      ? null
      : Number(req.body.expected_frequency_days);
    const notes = req.body?.notes == null ? null : `${req.body.notes}`.trim();

    if (!expenseId) return res.status(400).json({ error: 'expense_id is required' });
    if (expectedFrequencyDays != null && (!Number.isInteger(expectedFrequencyDays) || expectedFrequencyDays < 1 || expectedFrequencyDays > 365)) {
      return res.status(400).json({ error: 'expected_frequency_days must be between 1 and 365' });
    }

    const expense = await Expense.findById(expenseId);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const ownedByUser = expense.user_id === user.id;
    const inHousehold = user.household_id && expense.household_id === user.household_id;
    const canAccessExpense = ownedByUser || (inHousehold && expense.is_private !== true);
    if (!canAccessExpense) return res.status(404).json({ error: 'Expense not found' });

    const items = await ExpenseItem.findByExpenseId(expense.id);
    const identifiedItems = items.filter((item) => item.product_id || item.comparable_key);
    const primaryItem = identifiedItems[0] || items[0] || null;

    const preference = await RecurringPreference.upsert({
      userId: user.id,
      householdId: user.household_id,
      expenseId: expense.id,
      productId: primaryItem?.product_id || null,
      comparableKey: primaryItem?.comparable_key || null,
      merchant: expense.merchant || null,
      itemName: primaryItem?.description || expense.merchant || null,
      brand: primaryItem?.brand || null,
      expectedFrequencyDays,
      notes,
    });

    res.status(201).json(preference);
  } catch (err) { next(err); }
});

router.delete('/preferences/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const removed = await RecurringPreference.remove(req.params.id, user.id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const { merchant, expected_amount, category_id, frequency, next_expected_date } = req.body;
    if (!merchant || !expected_amount || !frequency || !next_expected_date) {
      return res.status(400).json({ error: 'merchant, expected_amount, frequency, next_expected_date required' });
    }
    const recurring = await RecurringExpense.create({
      householdId: user.household_id,
      ownedBy: 'household',
      userId: user.id,
      merchant,
      expectedAmount: expected_amount,
      categoryId: category_id,
      frequency,
      nextExpectedDate: next_expected_date,
    });
    res.status(201).json(recurring);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const recurring = await RecurringExpense.findById(req.params.id);
    if (!recurring || recurring.household_id !== user.household_id) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (recurring.user_id !== user.id) {
      return res.status(403).json({ error: 'Only the creator can remove this recurring expense' });
    }
    const removed = await RecurringExpense.remove(req.params.id, user.household_id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json(removed);
  } catch (err) { next(err); }
});

module.exports = router;
