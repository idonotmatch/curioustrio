const PushToken = require('../models/pushToken');
const InsightNotification = require('../models/insightNotification');
const { sendNotifications } = require('./pushService');
const { buildInsightsForUser } = require('./insightBuilder');

const PUSHABLE_INSIGHT_TYPES = new Set([
  'recurring_repurchase_due',
  'recurring_price_spike',
  'buy_soon_better_price',
]);

function toPushMessage(token, insight) {
  return {
    to: token.token,
    title: insight.title,
    body: insight.body,
    data: {
      type: 'insight',
      insight_id: insight.id,
      insight_type: insight.type,
      entity_type: insight.entity_type,
      entity_id: insight.entity_id,
      group_key: insight.metadata?.group_key || null,
    },
  };
}

async function dispatchInsightPushesForUser(user) {
  if (!user?.id) return { sent: 0, considered: 0 };
  const tokens = await PushToken.findByUser(user.id);
  if (!tokens.length) return { sent: 0, considered: 0 };

  const insights = await buildInsightsForUser({ user, limit: 10 });
  const candidates = insights.filter((insight) => (
    PUSHABLE_INSIGHT_TYPES.has(insight.type) &&
    insight.state?.status !== 'seen' &&
    insight.state?.status !== 'dismissed'
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
};
