const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(authenticate);

router.get('/events', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const since = req.query.since ? `${req.query.since}` : null;
    const sinceId = req.query.since_id ? `${req.query.since_id}` : null;
    if (since && Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'Invalid freshness cursor timestamp' });
    }
    if (sinceId && (!since || !UUID_PATTERN.test(sinceId))) {
      return res.status(400).json({ error: 'Invalid freshness cursor id' });
    }
    const events = await HouseholdFreshnessEvent.listForUser(user, {
      since,
      sinceId,
      limit: req.query.limit,
    });
    const lastEvent = events[events.length - 1] || null;
    res.json({
      events,
      latest_created_at: lastEvent?.created_at || since,
      next_cursor: lastEvent ? {
        created_at: lastEvent.created_at,
        id: lastEvent.id,
      } : {
        created_at: since,
        id: sinceId,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
