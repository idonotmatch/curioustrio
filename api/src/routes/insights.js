const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const InsightState = require('../models/insightState');
const InsightEvent = require('../models/insightEvent');
const { buildInsightsForUser } = require('../services/insightBuilder');
const { dispatchInsightPushesForUser } = require('../services/insightPushDispatcher');
const { buildFeedbackDebugSummary } = require('../services/insightFeedbackSummary');
const { inferOutcomeEventsForUser } = require('../services/insightOutcomeInference');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 25));
    const insights = await buildInsightsForUser({ user, limit });
    res.json(insights);
  } catch (err) {
    next(err);
  }
});

router.get('/feedback-summary', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.max(25, Math.min(Number(req.query.limit) || 250, 1000));
    const events = await InsightEvent.getRecentByUser(user.id, limit);
    const inferredEvents = await inferOutcomeEventsForUser({ user, events });
    res.json({
      user_id: user.id,
      event_count: events.length + inferredEvents.length,
      inferred_event_count: inferredEvents.length,
      ...buildFeedbackDebugSummary([...events, ...inferredEvents]),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/seen', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => `${id}`.trim()).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
    await InsightState.markSeen(user.id, ids);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!events.length) return res.status(400).json({ error: 'events array is required' });
    const logged = await InsightEvent.createBatch(user.id, events.slice(0, 50));
    if (!logged.length) {
      return res.status(400).json({ error: `events must include insight_id and event_type in ${InsightEvent.allowedEventTypes().join(', ')}` });
    }
    res.status(201).json(logged);
  } catch (err) {
    next(err);
  }
});

router.post('/dispatch-push', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await dispatchInsightPushesForUser(user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    await InsightState.dismiss(user.id, req.params.id);
    await InsightEvent.createBatch(user.id, [{
      insight_id: req.params.id,
      event_type: 'dismissed',
      metadata: null,
    }]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
