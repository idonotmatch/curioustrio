const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const ScenarioMemory = require('../models/scenarioMemory');
const { analyzeSpendingTrend } = require('../services/spendingTrendAnalyzer');
const { analyzeSpendProjection, evaluateScenarioAffordability } = require('../services/spendProjectionAnalyzer');
const { refreshConsideringScenarios } = require('../services/scenarioMemoryService');

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

    let memory = null;
    try {
      memory = await ScenarioMemory.create({
        userId: user.id,
        householdId: requestedScope === 'household' ? user.household_id : null,
        scope: result.scope,
        label: result.scenario?.label || req.body.label || 'purchase',
        amount: proposedAmount,
        month: result.month,
        scenario: result.scenario,
      });
    } catch (memoryErr) {
      console.error('[scenario memory] create failed (non-fatal):', memoryErr.message);
    }

    res.json({
      ...result,
      scenario_memory: memory,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/scenario-memory/:id/intent', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const intentSignal = `${req.body.intent_signal || ''}`.trim();
    if (!['considering', 'not_right_now', 'just_exploring'].includes(intentSignal)) {
      return res.status(400).json({ error: 'intent_signal must be considering, not_right_now, or just_exploring' });
    }

    let memory = null;
    try {
      memory = await ScenarioMemory.recordIntent(req.params.id, user.id, intentSignal);
    } catch (memoryErr) {
      console.error('[scenario memory] intent update failed (non-fatal):', memoryErr.message);
      return res.status(503).json({ error: 'Scenario memory not available yet' });
    }
    if (!memory) return res.status(404).json({ error: 'Scenario memory not found' });

    res.json({ scenario_memory: memory });
  } catch (err) {
    next(err);
  }
});

router.post('/scenario-memory/:id/watch', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const enabled = req.body.enabled !== false;

    let memory = null;
    try {
      memory = await ScenarioMemory.updateWatch(req.params.id, user.id, enabled);
    } catch (memoryErr) {
      console.error('[scenario memory] watch update failed (non-fatal):', memoryErr.message);
      return res.status(503).json({ error: 'Scenario memory not available yet' });
    }
    if (!memory) return res.status(404).json({ error: 'Scenario memory not found' });

    res.json({ scenario_memory: memory });
  } catch (err) {
    next(err);
  }
});

router.get('/scenario-memory/recent', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    try {
      await refreshConsideringScenarios(user, {
        limit: Math.max(1, Math.min(Number(req.query.limit) || 3, 5)),
      });
    } catch (refreshErr) {
      console.error('[scenario memory] passive refresh failed (non-fatal):', refreshErr.message);
    }

    let items = [];
    try {
      items = await ScenarioMemory.listRecentActiveByUser(user.id, {
        limit: req.query.limit || 3,
      });
    } catch (listErr) {
      console.error('[scenario memory] recent list failed (non-fatal):', listErr.message);
      items = [];
    }

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
