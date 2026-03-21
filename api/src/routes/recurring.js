const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const RecurringExpense = require('../models/recurringExpense');
const { detectRecurring } = require('../services/recurringDetector');

router.use(authenticate);

async function getUser(req) { return User.findByAuth0Id(req.auth0Id); }

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
    const removed = await RecurringExpense.remove(req.params.id, user.household_id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json(removed);
  } catch (err) { next(err); }
});

module.exports = router;
