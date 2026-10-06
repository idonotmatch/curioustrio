const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');
const { parseFreshnessCursor } = require('../services/freshnessCursor');

const router = express.Router();

router.use(authenticate);

router.get('/events', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const cursor = parseFreshnessCursor(req.query);
    if (cursor.error) return res.status(400).json({ error: cursor.error });
    const { since, sinceId } = cursor;
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
