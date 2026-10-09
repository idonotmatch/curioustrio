const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const RecurringExpense = require('../models/recurringExpense');
const RecurringPreference = require('../models/recurringPreference');
const ItemPlanningPreference = require('../models/itemPlanningPreference');
const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const {
  detectRecurring,
  detectRecurringItems,
  detectRecurringItemSignals,
  detectRecurringWatchCandidates,
} = require('../services/recurringDetector');
const {
  compactItemHistorySummary,
  getItemHistoryByGroupKey,
  listItemHistorySummaries,
} = require('../services/itemHistoryService');
const { findObservationOpportunities } = require('../services/priceObservationService');
const { emitRecurringFreshnessEvent } = require('../services/freshnessEvents');

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
    const candidates = await detectRecurring(user.household_id, { requesterUserId: user.id });
    res.json(candidates);
  } catch (err) { next(err); }
});

router.post('/detect-items', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const candidates = await detectRecurringItems(user.household_id, { requesterUserId: user.id });
    res.json(candidates);
  } catch (err) { next(err); }
});

router.post('/detect-item-signals', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const signals = await detectRecurringItemSignals(user.household_id, { requesterUserId: user.id });
    res.json(signals);
  } catch (err) { next(err); }
});

router.get('/item-histories', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const scope = `${req.query.scope || ''}`.trim() === 'personal' ? 'personal' : 'household';
    if (scope === 'household' && !user.household_id) {
      return res.status(403).json({ error: 'Must be in a household' });
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 200));
    const lookbackDays = Math.max(30, Math.min(Number(req.query.lookback_days) || 180, 365));
    const ownerId = scope === 'personal' ? user.id : user.household_id;
    const histories = await listItemHistorySummaries(ownerId, {
      scope,
      lookbackDays,
      minOccurrences: 2,
      limit,
      requesterUserId: user.id,
      automaticInsightsOnly: false,
    });
    const summaries = histories
      .map(compactItemHistorySummary)
      .sort((a, b) => (
        `${b.last_purchased_at || ''}`.localeCompare(`${a.last_purchased_at || ''}`)
        || b.occurrence_count - a.occurrence_count
        || `${a.item_name || ''}`.localeCompare(`${b.item_name || ''}`)
      ));
    res.json(summaries);
  } catch (err) { next(err); }
});

router.get('/bundle-history', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const scope = `${req.query.scope || ''}`.trim() === 'personal' ? 'personal' : 'household';
    if (scope === 'household' && !user.household_id) {
      return res.status(403).json({ error: 'Must be in a household' });
    }
    const groupKeys = `${req.query.group_keys || ''}`
      .split(',')
      .map((value) => value.trim())
      .filter((value, index, values) => /^(product|comparable):.+/.test(value) && values.indexOf(value) === index)
      .slice(0, 8);
    if (groupKeys.length < 2) {
      return res.status(400).json({ error: 'At least two valid group_keys are required' });
    }
    const ownerId = scope === 'personal' ? user.id : user.household_id;
    const histories = await Promise.all(groupKeys.map((groupKey) => getItemHistoryByGroupKey(ownerId, groupKey, {
      scope,
      requesterUserId: user.id,
    })));
    const items = histories.filter(Boolean);
    if (items.length < 2) return res.status(404).json({ error: 'Basket history not found' });
    const merchantCounts = new Map();
    items.forEach((item) => (item.merchants || []).forEach((merchant) => {
      merchantCounts.set(merchant, (merchantCounts.get(merchant) || 0) + 1);
    }));
    const usualMerchants = [...merchantCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([merchant]) => merchant);
    res.json({
      kind: 'item_bundle_history',
      scope,
      item_count: items.length,
      typical_combined_cost: Number(items.reduce((sum, item) => sum + Number(item.median_amount || 0), 0).toFixed(2)),
      usual_merchants: usualMerchants,
      items,
    });
  } catch (err) { next(err); }
});

router.get('/item-history', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const groupKey = `${req.query.group_key || ''}`.trim();
    const scope = `${req.query.scope || ''}`.trim() === 'personal' ? 'personal' : 'household';
    if (!groupKey) return res.status(400).json({ error: 'group_key is required' });
    if (scope === 'household' && !user?.household_id) {
      return res.status(403).json({ error: 'Must be in a household' });
    }
    const ownerId = scope === 'personal' ? user.id : user.household_id;
    const [history, planningPreference] = await Promise.all([
      getItemHistoryByGroupKey(ownerId, groupKey, { scope, requesterUserId: user.id }),
      ItemPlanningPreference.findByUserAndGroup(user.id, groupKey),
    ]);
    if (!history) return res.status(404).json({ error: 'Recurring item history not found' });
    res.json({ ...history, planning_preference: planningPreference });
  } catch (err) { next(err); }
});

router.get('/item-preferences', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const groupKey = `${req.query.group_key || ''}`.trim();
    const state = `${req.query.state || ''}`.trim() || null;
    if (state && !['watching', 'needed', 'suppressed'].includes(state)) {
      return res.status(400).json({ error: 'state is invalid' });
    }
    if (groupKey) {
      const preference = await ItemPlanningPreference.findByUserAndGroup(user.id, groupKey);
      return res.json(preference || null);
    }
    res.json(await ItemPlanningPreference.findByUser(user.id, { state }));
  } catch (err) { next(err); }
});

router.put('/item-preferences', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const groupKey = `${req.body?.group_key || ''}`.trim();
    const state = `${req.body?.state || 'watching'}`.trim();
    const remindOn = req.body?.remind_on ? `${req.body.remind_on}`.slice(0, 10) : null;
    const targetPrice = req.body?.target_price == null || req.body?.target_price === ''
      ? null
      : Number(req.body.target_price);
    const notes = req.body?.notes == null ? null : `${req.body.notes}`.trim().slice(0, 500);
    if (!/^(product|comparable):.+/.test(groupKey)) {
      return res.status(400).json({ error: 'group_key is invalid' });
    }
    if (!['watching', 'needed', 'suppressed'].includes(state)) {
      return res.status(400).json({ error: 'state is invalid' });
    }
    if (remindOn && !/^\d{4}-\d{2}-\d{2}$/.test(remindOn)) {
      return res.status(400).json({ error: 'remind_on must be an ISO date' });
    }
    if (targetPrice != null && (!Number.isFinite(targetPrice) || targetPrice <= 0 || targetPrice > 1_000_000)) {
      return res.status(400).json({ error: 'target_price must be a positive amount' });
    }
    const preference = await ItemPlanningPreference.upsert({
      userId: user.id,
      householdId: user.household_id || null,
      groupKey,
      state,
      remindOn,
      targetPrice,
      notes,
    });
    await emitRecurringFreshnessEvent(user, 'item_planning_preference_saved', {
      group_key: groupKey,
      state,
    });
    res.json(preference);
  } catch (err) { next(err); }
});

router.get('/planning-items', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const preferences = (await ItemPlanningPreference.findByUser(user.id, { state: 'needed' })).slice(0, 50);
    const ownerId = user.household_id || user.id;
    const scope = user.household_id ? 'household' : 'personal';
    const rows = await Promise.all(preferences.map(async (preference) => {
      const history = await getItemHistoryByGroupKey(ownerId, preference.group_key, {
        scope,
        requesterUserId: user.id,
      });
      if (!history) return null;
      return {
        ...preference,
        scope,
        item_name: history.item_name,
        brand: history.brand,
        median_amount: history.median_amount,
        median_unit_price: history.median_unit_price,
        price_basis_unit: history.price_basis_unit || history.normalized_total_size_unit,
        usual_merchant: history.merchant_breakdown?.[0]?.merchant || history.merchants?.[0] || null,
        last_purchased_at: history.last_purchased_at,
      };
    }));
    res.json(rows.filter(Boolean));
  } catch (err) { next(err); }
});

router.get('/watch-candidates', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    const windowDays = Math.max(1, Math.min(Number(req.query.window_days) || 5, 30));
    const candidates = await detectRecurringWatchCandidates(user.household_id, {
      windowDays,
      requesterUserId: user.id,
    });
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
      requesterUserId: user.id,
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
    await emitRecurringFreshnessEvent(user, 'recurring_preference_saved', { expense_id: expense.id });

    res.status(201).json(preference);
  } catch (err) { next(err); }
});

router.delete('/preferences/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const removed = await RecurringPreference.remove(req.params.id, user.id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    await emitRecurringFreshnessEvent(user, 'recurring_preference_deleted', { preference_id: req.params.id });
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
    await emitRecurringFreshnessEvent(user, 'recurring_created', { recurring_id: recurring.id });
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
    await emitRecurringFreshnessEvent(user, 'recurring_deleted', { recurring_id: req.params.id });
    res.json(removed);
  } catch (err) { next(err); }
});

module.exports = router;
