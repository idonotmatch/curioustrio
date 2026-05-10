const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');

const router = express.Router();

router.use(authenticate);

router.get('/events', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const since = req.query.since ? `${req.query.since}` : null;
    const events = await HouseholdFreshnessEvent.listForUser(user, {
      since,
      limit: req.query.limit,
    });
    res.json({
      events,
      latest_created_at: events.length ? events[events.length - 1].created_at : since,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
