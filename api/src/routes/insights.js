const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const InsightState = require('../models/insightState');
const InsightEvent = require('../models/insightEvent');
const { buildInsightsForUser, buildInsightDebugForUser, buildInsightPreferencesForUser } = require('../services/insightBuilder');
const { dispatchInsightPushesForUser } = require('../services/insightPushDispatcher');
const { buildFeedbackDebugSummary } = require('../services/insightFeedbackSummary');
const { inferOutcomeEventsForUser } = require('../services/insightOutcomeInference');
const { attachInsightAction } = require('../services/insightAction');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

function toExposureMetadata(insight, index, limit) {
  const metadata = insight?.metadata || {};
  const action = insight?.action || null;
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
    next_step_type: action?.next_step_type || null,
    action_cta: action?.cta || null,
  };
}

function buildCalibrationDebugResponse(debug = {}) {
  const comparison = debug?.ranking_comparison || {};
  const legacyTop = Array.isArray(comparison.legacy_top) ? comparison.legacy_top : [];
  const thresholdTop = Array.isArray(comparison.threshold_top) ? comparison.threshold_top : [];
  const suppressed = Array.isArray(comparison.suppressed_candidates) ? comparison.suppressed_candidates : [];

  return {
    user_id: debug.user_id,
    limit: debug.limit,
    raw_count: debug.raw?.count || 0,
    final_count: debug.final?.count || 0,
    surface_summary: debug.surface_summary || null,
    ranking_comparison: {
      legacy_top,
      threshold_top: thresholdTop,
      newly_dropped_from_legacy_top: legacyTop.filter((legacy) => !thresholdTop.some((next) => next.id === legacy.id)),
      newly_added_to_threshold_top: thresholdTop.filter((next) => !legacyTop.some((legacy) => legacy.id === next.id)),
    },
    top_suppressed_candidates: suppressed.slice(0, Math.max(10, Number(debug.limit || 10))),
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
    const insights = (await buildInsightsForUser({ user, limit })).map(attachInsightAction);
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
    if (`${req.query.view || ''}`.trim() === 'calibration') {
      return res.json(buildCalibrationDebugResponse(debug));
    }
    res.json(debug);
  } catch (err) {
    next(err);
  }
});

router.get('/preferences', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const limit = Math.max(25, Math.min(Number(req.query.limit) || 500, 1000));
    const summary = await buildInsightPreferencesForUser({ user, limit });
    res.json(summary);
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
