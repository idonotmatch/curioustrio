const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const MerchantMapping = require('../models/merchantMapping');
const { parseExpense } = require('../services/nlParser');
const { assignCategory } = require('../services/categoryAssigner');

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
      householdId: user?.household_id,
      categories,
    });

    res.json({ ...parsed, category_id, category_source: source, category_confidence: confidence });
  } catch (err) { next(err); }
});

// Confirm expense → save to DB + update merchant mapping
router.post('/confirm', async (req, res, next) => {
  try {
    const { merchant, amount, date, category_id, source, notes,
            place_name, address, mapkit_stable_id } = req.body;

    if (!merchant || !amount || !date || !source) {
      return res.status(400).json({ error: 'merchant, amount, date, source required' });
    }

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });

    if (category_id !== undefined && category_id !== null && !UUID_RE.test(category_id)) {
      return res.status(400).json({ error: 'category_id must be a valid UUID' });
    }

    const expense = await Expense.create({
      userId: user.id,
      householdId: user?.household_id,
      merchant, amount, date,
      categoryId: category_id,
      source,
      status: 'confirmed',
      notes,
      placeName: place_name,
      address,
      mapkitStableId: mapkit_stable_id,
    });

    // Update merchant memory
    if (category_id && user?.household_id) {
      await MerchantMapping.upsert({
        householdId: user.household_id,
        merchantName: merchant,
        categoryId: category_id,
      });
    }

    res.status(201).json(expense);
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

module.exports = router;
