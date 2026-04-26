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

function buildInsightAction(insight) {
  const type = `${insight?.type || ''}`.trim();
  const metadata = insight?.metadata || {};
  const scope = metadata.scope || 'personal';
  const month = metadata.month || '';

  if (type === 'usage_start_logging' || type === 'usage_building_history') {
    return {
      next_step_type: 'log_expense',
      reason: 'Build the baseline',
      title: 'Log a few more expenses',
      body: 'A little more activity will make the next set of insights more specific and more useful.',
      cta: 'Log expense',
      route: { pathname: '/(tabs)/add', params: {} },
    };
  }

  if (type === 'usage_set_budget') {
    return {
      next_step_type: 'set_budget',
      reason: 'Needs setup',
      title: 'Set the budget baseline',
      body: 'A budget target gives Adlo something concrete to compare your spending against.',
      cta: 'Set budget',
      route: { pathname: '/budget-period', params: {} },
    };
  }

  if (type === 'usage_ready_to_plan') {
    return {
      next_step_type: 'plan_purchase',
      reason: metadata?.planning_confidence === 'directional' ? 'Directional read' : 'Ready to plan',
      title: 'Pressure-test the purchase',
      body: metadata?.planning_confidence === 'directional'
        ? 'Start with a smaller what-if first, then compare timing before treating the room as fully reliable.'
        : 'Compare whether this fits better now, next period, or spread across a few periods.',
      cta: 'Open planner',
      route: { pathname: '/scenario-check', params: { scope, month } },
    };
  }

  if (type === 'early_cleanup') {
    return {
      next_step_type: 'clean_up_categories',
      reason: 'Improve future reads',
      title: 'Clean up the inputs first',
      body: 'Fixing uncategorized or shaky expenses is the fastest way to make future insight cards more specific.',
      cta: 'Open categories',
      route: { pathname: '/categories', params: {} },
    };
  }

  if (insight?.entity_type === 'item' && metadata?.group_key) {
    return {
      next_step_type: 'review_item_detail',
      reason: 'Item signal',
      title: 'Review the item detail',
      body: 'Use the item history and recent purchases to decide whether this is worth acting on now.',
      cta: 'Open item detail',
      route: {
        pathname: '/recurring-item',
        params: {
          group_key: metadata.group_key,
          scope,
          title: metadata.item_name || insight.title,
          insight_id: insight.id,
          insight_type: insight.type,
          body: insight.body,
        },
      },
    };
  }

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'budget_too_low'
    || type === 'budget_too_high'
    || type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'recurring_cost_pressure'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'one_off_expense_skewing_projection'
    || type === 'projected_category_surge'
  ) {
    return {
      next_step_type: 'review_trend_detail',
      reason: 'Needs context',
      title: 'Read the driver first',
      body: 'Use the breakdown to see whether this is broad pressure, one unusual purchase, or a category shift.',
      cta: 'Open detail',
      route: {
        pathname: '/trend-detail',
        params: {
          scope,
          month,
          insight_type: insight.type,
          category_key: metadata.category_key || '',
          title: insight.title,
          insight_id: insight.id,
        },
      },
    };
  }

  if (
    type.startsWith('early_')
    || type.startsWith('developing_')
  ) {
    return {
      next_step_type: 'review_insight_detail',
      reason: 'Early signal',
      title: 'Read the signal in context',
      body: 'This is an early read, so the most useful next step is understanding the pattern before reacting too hard.',
      cta: 'Open detail',
      route: {
        pathname: '/insight-detail',
        params: {
          insight_id: insight.id,
          insight_type: insight.type,
          title: insight.title,
          body: insight.body,
          severity: insight.severity || 'low',
          entity_type: insight.entity_type || '',
          entity_id: insight.entity_id || '',
        },
      },
    };
  }

  return {
    next_step_type: 'review_detail',
    reason: 'Needs context',
    title: 'Review the detail',
    body: 'Open the supporting detail before deciding whether this is worth acting on.',
    cta: 'Open detail',
    route: null,
  };
}

function attachInsightAction(insight) {
  if (!insight) return insight;
  return {
    ...insight,
    action: buildInsightAction(insight),
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
