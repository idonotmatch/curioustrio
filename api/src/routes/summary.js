const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const UserSummarySnapshot = require('../models/userSummarySnapshot');
const { buildSummaryBundle } = require('../services/summaryBundleService');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const period = /^\d{4}-\d{2}$/.test(`${req.query.period || ''}`)
      ? `${req.query.period}`
      : new Date().toISOString().slice(0, 7);
    const requestedStartDay = Number(req.query.start_day || user.budget_start_day || 1);
    if (!Number.isInteger(requestedStartDay) || requestedStartDay < 1 || requestedStartDay > 28) {
      return res.status(400).json({ error: 'start_day must be between 1 and 28' });
    }

    const snapshot = await UserSummarySnapshot.find(user.id, period, requestedStartDay);
    if (snapshot?.payload) {
      res.setHeader('x-adlo-summary-source', 'projection');
      return res.json(snapshot.payload);
    }

    const payload = await buildSummaryBundle({ user, period, startDay: requestedStartDay });
    await UserSummarySnapshot.upsert({
      userId: user.id,
      householdId: user.household_id,
      period,
      startDay: requestedStartDay,
      payload,
    });
    res.setHeader('x-adlo-summary-source', 'live');
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
