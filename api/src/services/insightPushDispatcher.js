const PushToken = require('../models/pushToken');
const InsightNotification = require('../models/insightNotification');
const { sendNotifications } = require('./pushService');
const { buildInsightsForUser } = require('./insightBuilder');
const { pushNotificationsEnabled } = require('./pushPreferences');
const InsightEvent = require('../models/insightEvent');
const { inferOutcomeEventsForUser, summarizeOutcomeWindows } = require('./insightOutcomeInference');
const { buildInsightPreferenceSummary, shouldSendPushForInsight } = require('./insightPreferenceSummary');

const PUSHABLE_INSIGHT_TYPES = new Set([
  'recurring_repurchase_due',
  'recurring_price_spike',
  'buy_soon_better_price',
]);

function trimSentence(value = '', max = 140) {
  const text = `${value || ''}`.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function pushCopyForInsight(insight) {
  if (insight?.type === 'buy_soon_better_price') {
    return {
      title: 'Price insight ready',
      body: 'Open Adlo to review a recent price opportunity.',
    };
  }

  if (insight?.type === 'recurring_price_spike') {
    return {
      title: 'Spending insight ready',
      body: 'Open Adlo to review a recent price change.',
    };
  }

  if (insight?.type === 'recurring_repurchase_due') {
    return {
      title: 'Routine reminder ready',
      body: 'Open Adlo to review a likely upcoming purchase.',
    };
  }

  return {
    title: 'New insight ready',
    body: 'Open Adlo to review it.',
  };
}

function pushNavigationMetadata(insight) {
  const metadata = insight?.metadata || {};
  return {
    scope: metadata.scope || null,
    month: metadata.month || null,
    category_key: metadata.category_key || null,
    merchant_key: metadata.merchant_key || null,
    continuity_key: metadata.continuity_key || null,
    group_key: metadata.group_key || null,
  };
}

function toPushMessage(token, insight) {
  const copy = pushCopyForInsight(insight);
  const metadata = pushNavigationMetadata(insight);
  return {
    to: token.token,
    title: copy.title,
    body: copy.body,
    data: {
      type: 'insight',
      route: '/insight-detail',
      insight_id: insight.id,
      insight_type: insight.type,
      severity: insight.severity || null,
      entity_type: insight.entity_type,
      entity_id: insight.entity_id,
      scope: metadata.scope,
      month: metadata.month,
      group_key: metadata.group_key,
      metadata,
    },
  };
}

async function dispatchInsightPushesForUser(user) {
  if (!user?.id) return { sent: 0, considered: 0 };
  if (!pushNotificationsEnabled(user, 'push_insights_enabled')) return { sent: 0, considered: 0 };
  const tokens = await PushToken.findByUser(user.id);
  if (!tokens.length) return { sent: 0, considered: 0 };

  const [insights, recentEvents] = await Promise.all([
    buildInsightsForUser({ user, limit: 10 }),
    InsightEvent.getRecentByUser(user.id, 500),
  ]);
  const inferredEvents = await inferOutcomeEventsForUser({ user, events: recentEvents });
  const allEvents = [...recentEvents, ...inferredEvents];
  const preferenceSummary = buildInsightPreferenceSummary(allEvents, {
    outcomeWindows: summarizeOutcomeWindows(allEvents),
  });
  const candidates = insights.filter((insight) => (
    PUSHABLE_INSIGHT_TYPES.has(insight.type) &&
    insight.state?.status !== 'seen' &&
    insight.state?.status !== 'dismissed' &&
    shouldSendPushForInsight(insight, preferenceSummary)
  ));
  if (!candidates.length) return { sent: 0, considered: 0 };

  const sentIds = await InsightNotification.findSentIds(user.id, candidates.map((insight) => insight.id), 'push');
  const unsent = candidates.filter((insight) => !sentIds.has(insight.id)).slice(0, 2);
  if (!unsent.length) return { sent: 0, considered: candidates.length };

  const messages = tokens.flatMap((token) => unsent.map((insight) => toPushMessage(token, insight)));
  if (!messages.length) return { sent: 0, considered: candidates.length };

  await sendNotifications(messages);
  await InsightNotification.createBatch(user.id, unsent.map((insight) => insight.id), 'push');

  return {
    sent: messages.length,
    considered: candidates.length,
    notified_insight_ids: unsent.map((insight) => insight.id),
  };
}

module.exports = {
  dispatchInsightPushesForUser,
  PUSHABLE_INSIGHT_TYPES,
  pushCopyForInsight,
};
