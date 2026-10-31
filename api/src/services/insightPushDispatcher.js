const PushToken = require('../models/pushToken');
const InsightNotification = require('../models/insightNotification');
const { sendNotifications } = require('./pushService');
const { buildInsightsForUser } = require('./insightBuilder');
const { pushNotificationsEnabled } = require('./pushPreferences');
const { safePushData, shouldSendInsightPush } = require('./pushEligibility');
const InsightEvent = require('../models/insightEvent');
const { inferOutcomeEventsForUser, summarizeOutcomeWindows } = require('./insightOutcomeInference');
const { buildInsightPreferenceSummary, shouldSendPushForInsight } = require('./insightPreferenceSummary');
const { isMorningDeliveryWindow } = require('./notificationTiming');

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
      title: 'A usual purchase is cheaper',
      body: 'Its current price is below your recent range. Open Adlo to compare.',
    };
  }

  if (insight?.type === 'recurring_price_spike') {
    return {
      title: 'A usual purchase got pricier',
      body: 'Its latest price is above your recent range. Open Adlo for context.',
    };
  }

  if (insight?.type === 'recurring_repurchase_due') {
    return {
      title: 'A usual purchase may be due',
      body: 'Review timing and typical cost before your next trip.',
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
    pushTokenId: token.id,
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
      metadata: safePushData(metadata),
    },
  };
}

function preferenceEnabledForInsight(user, insight) {
  if (insight?.type === 'recurring_repurchase_due') {
    return pushNotificationsEnabled(user, 'push_recurring_enabled');
  }
  return pushNotificationsEnabled(user, 'push_insights_enabled');
}

async function dispatchInsightPushesForUser(user, options = {}) {
  if (!user?.id) return { sent: 0, considered: 0 };
  if (
    !pushNotificationsEnabled(user, 'push_insights_enabled')
    && !pushNotificationsEnabled(user, 'push_recurring_enabled')
  ) {
    return { sent: 0, considered: 0 };
  }
  const now = options.now || new Date();
  const enforceWindow = options.enforceWindow ?? process.env.NODE_ENV !== 'test';
  if (enforceWindow && !isMorningDeliveryWindow(user, now)) {
    return { sent: 0, considered: 0, skipped: 'outside_delivery_window' };
  }
  if (await InsightNotification.hasSentSince(user.id, 'push', new Date(now.getTime() - 20 * 60 * 60 * 1000))) {
    return { sent: 0, considered: 0, skipped: 'daily_limit' };
  }
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
    shouldSendInsightPush({ insight, allowedTypes: PUSHABLE_INSIGHT_TYPES }).send &&
    preferenceEnabledForInsight(user, insight) &&
    shouldSendPushForInsight(insight, preferenceSummary)
  ));
  if (!candidates.length) return { sent: 0, considered: 0 };

  const sentIds = await InsightNotification.findSentIds(user.id, candidates.map((insight) => insight.id), 'push');
  const sentContinuityKeys = await InsightNotification.findRecentContinuityKeys(
    user.id,
    candidates.map((insight) => insight?.metadata?.continuity_key).filter(Boolean),
    'push',
    new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  );
  const unsent = candidates.filter((insight) => shouldSendInsightPush({
    insight,
    sentIds,
    sentContinuityKeys,
    allowedTypes: PUSHABLE_INSIGHT_TYPES,
  }).send).slice(0, 1);
  if (!unsent.length) return { sent: 0, considered: candidates.length };

  const messages = tokens.flatMap((token) => unsent.map((insight) => toPushMessage(token, insight)));
  if (!messages.length) return { sent: 0, considered: candidates.length };

  const insight = unsent[0];
  const category = insight.type === 'recurring_repurchase_due' ? 'recurring' : 'insight';
  const delivery = await sendNotifications(messages, {
    userId: user.id,
    category,
    notificationKey: `insight:${insight.id}`,
    metadata: { insight_type: insight.type, continuity_key: insight?.metadata?.continuity_key || null },
  });
  if (delivery.accepted > 0) {
    await InsightNotification.createBatch(user.id, unsent, 'push');
  }

  return {
    sent: delivery.accepted,
    rejected: delivery.rejected,
    considered: candidates.length,
    notified_insight_ids: unsent.map((insight) => insight.id),
  };
}

module.exports = {
  dispatchInsightPushesForUser,
  PUSHABLE_INSIGHT_TYPES,
  pushCopyForInsight,
};
