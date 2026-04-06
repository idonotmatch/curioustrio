const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const { analyzeSpendingTrend } = require('../services/spendingTrendAnalyzer');
const { analyzeSpendProjection, evaluateScenarioAffordability } = require('../services/spendProjectionAnalyzer');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

router.get('/summary', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const requestedScope = req.query.scope === 'household' ? 'household' : 'personal';
    if (requestedScope === 'household' && !user.household_id) {
      return res.status(403).json({ error: 'Must be in a household for household trends' });
    }

    const summary = await analyzeSpendingTrend({
      user,
      scope: requestedScope,
      month: req.query.month || null,
    });
    const projection = await analyzeSpendProjection({
      user,
      scope: requestedScope,
      month: req.query.month || null,
    });
    res.json({
      ...summary,
      projection,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/scenario-check', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const requestedScope = req.body.scope === 'household' ? 'household' : 'personal';
    if (requestedScope === 'household' && !user.household_id) {
      return res.status(403).json({ error: 'Must be in a household for household scenarios' });
    }

    const proposedAmount = Number(req.body.proposed_amount);
    if (!(proposedAmount > 0)) {
      return res.status(400).json({ error: 'proposed_amount must be greater than 0' });
    }

    const result = await evaluateScenarioAffordability({
      user,
      scope: requestedScope,
      month: req.body.month || null,
      proposedAmount,
      label: req.body.label || 'purchase',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
