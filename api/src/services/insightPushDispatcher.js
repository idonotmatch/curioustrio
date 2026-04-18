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
  const merchant = insight?.metadata?.merchant_name || insight?.metadata?.merchant_key || null;
  const store = insight?.metadata?.store_name || insight?.metadata?.retailer_name || null;
  const product = insight?.metadata?.product_name || insight?.title || 'item';

  if (insight?.type === 'buy_soon_better_price') {
    return {
      title: 'Better price spotted',
      body: trimSentence(
        `${product}${store ? ` is cheaper at ${store}` : ' is below your usual price'}${insight?.body ? `. ${insight.body}` : ''}`,
        150
      ),
    };
  }

  if (insight?.type === 'recurring_price_spike') {
    return {
      title: 'A usual buy got pricier',
      body: trimSentence(
        `${merchant || product} looks higher than usual${insight?.body ? `. ${insight.body}` : ''}`,
        150
      ),
    };
  }

  if (insight?.type === 'recurring_repurchase_due') {
    return {
      title: 'You may need this again soon',
      body: trimSentence(
        `${merchant || product} is due again soon${insight?.body ? `. ${insight.body}` : ''}`,
        150
      ),
    };
  }

  return {
    title: trimSentence(insight?.title || 'New insight', 60),
    body: trimSentence(insight?.body || 'We noticed something worth a look.', 150),
  };
}

function toPushMessage(token, insight) {
  const copy = pushCopyForInsight(insight);
  return {
    to: token.token,
    title: copy.title,
    body: copy.body,
    data: {
      type: 'insight',
      route: '/insight-detail',
      insight_id: insight.id,
      insight_type: insight.type,
      title: insight.title,
      body: insight.body,
      severity: insight.severity || null,
      entity_type: insight.entity_type,
      entity_id: insight.entity_id,
      group_key: insight.metadata?.group_key || null,
      metadata: insight.metadata || null,
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
