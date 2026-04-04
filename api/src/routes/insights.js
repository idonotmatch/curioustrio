const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { buildInsights } = require('../services/insightBuilder');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.json([]);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 25));
    const insights = await buildInsights({ householdId: user.household_id, limit });
    res.json(insights);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
