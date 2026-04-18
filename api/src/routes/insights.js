const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const InsightState = require('../models/insightState');
const InsightEvent = require('../models/insightEvent');
const { buildInsightsForUser, buildInsightDebugForUser } = require('../services/insightBuilder');
const { dispatchInsightPushesForUser } = require('../services/insightPushDispatcher');
const { buildFeedbackDebugSummary } = require('../services/insightFeedbackSummary');
const { inferOutcomeEventsForUser } = require('../services/insightOutcomeInference');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

function toExposureMetadata(insight, index, limit) {
  const metadata = insight?.metadata || {};
  return {
    source: 'insights_index',
    rank: index + 1,
    returned_limit: limit,
    type: insight?.type || null,
    severity: insight?.severity || null,
    entity_type: insight?.entity_type || null,
    entity_id: insight?.entity_id || null,
    scope: metadata.scope || null,
    maturity: metadata.maturity || null,
    confidence: metadata.confidence || null,
    hierarchy_level: metadata.hierarchy_level || null,
    scope_origin: metadata.scope_origin || null,
    scope_relationship: metadata.scope_relationship || null,
    continuity_key: metadata.continuity_key || null,
    comparison_type: metadata.comparison_type || null,
  };
}

async function recordInsightExposures(userId, insights, limit) {
  if (!userId || !Array.isArray(insights) || !insights.length) return;
  const recentShownMap = await InsightEvent.getRecentShownMap(
    userId,
    insights.map((insight) => insight.id),
    6
  );
  const events = insights
    .filter((insight) => insight?.id && !recentShownMap.has(insight.id))
    .map((insight, index) => ({
      insight_id: insight.id,
      event_type: 'shown',
      metadata: toExposureMetadata(insight, index, limit),
    }));
  if (!events.length) return;
  await InsightEvent.createBatch(userId, events);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 25));
    const insights = await buildInsightsForUser({ user, limit });
    await recordInsightExposures(user.id, insights, limit);
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

router.get('/debug', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 25));
    const debug = await buildInsightDebugForUser({ user, limit });
    res.json(debug);
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
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object'
      ? req.body.metadata
      : null;
    await InsightState.dismiss(user.id, req.params.id);
    await InsightEvent.createBatch(user.id, [{
      insight_id: req.params.id,
      event_type: 'dismissed',
      metadata,
    }]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
