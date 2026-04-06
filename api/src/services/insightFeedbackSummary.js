const POSITIVE_OPPORTUNITY_TYPES = new Set([
  'buy_soon_better_price',
  'projected_month_end_under_budget',
  'projected_category_under_baseline',
  'recurring_restock_window',
]);

function normalizeInsightType(event = {}) {
  const metadataType = `${event?.metadata?.insight_type || event?.metadata?.type || ''}`.trim();
  if (metadataType) return metadataType;

  const insightId = `${event?.insight_id || ''}`.trim();
  if (!insightId) return '';

  const prefix = insightId.split(':')[0];
  if (prefix === 'top_driver') return 'top_category_driver';
  if (prefix === 'one_offs') return 'one_offs_driving_variance';
  if (prefix === 'too_low') return 'budget_too_low';
  if (prefix === 'too_high') return 'budget_too_high';
  return prefix;
}

function isPositiveOpportunityType(insightType) {
  return POSITIVE_OPPORTUNITY_TYPES.has(insightType);
}

function summarizeFeedbackEvents(events = []) {
  const summary = new Map();

  for (const event of events) {
    const insightType = normalizeInsightType(event);
    if (!insightType) continue;

    const current = summary.get(insightType) || {
      helpful: 0,
      not_helpful: 0,
      tapped: 0,
      dismissed: 0,
      shown: 0,
      reasons: {},
      last_negative_at: null,
      last_helpful_at: null,
    };

    current[event.event_type] = (current[event.event_type] || 0) + 1;

    if (event.event_type === 'not_helpful') {
      const reason = `${event?.metadata?.reason || ''}`.trim();
      if (reason) {
        current.reasons[reason] = (current.reasons[reason] || 0) + 1;
      }
      current.last_negative_at = event.created_at || current.last_negative_at;
    }

    if (event.event_type === 'dismissed') {
      current.last_negative_at = event.created_at || current.last_negative_at;
    }

    if (event.event_type === 'helpful') {
      current.last_helpful_at = event.created_at || current.last_helpful_at;
    }

    summary.set(insightType, current);
  }

  return summary;
}

function daysSince(timestamp) {
  if (!timestamp) return null;
  const diff = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(diff)) return null;
  return diff / (24 * 60 * 60 * 1000);
}

function suppressionWindowDays(insightType, stats = {}) {
  const wrongTimingCount = stats.reasons?.wrong_timing || 0;
  const notRelevantCount = stats.reasons?.not_relevant || 0;
  const notAccurateCount = stats.reasons?.not_accurate || 0;
  const alreadyKnewCount = stats.reasons?.already_knew || 0;
  const dismissedCount = stats.dismissed || 0;
  const notHelpfulCount = stats.not_helpful || 0;
  const positiveOpportunity = isPositiveOpportunityType(insightType);

  if (positiveOpportunity && (alreadyKnewCount >= 1 || notRelevantCount >= 1) && (dismissedCount >= 1 || notHelpfulCount >= 1)) return 30;
  if (notAccurateCount >= 2 || notRelevantCount >= 2 || notHelpfulCount >= 3) return 21;
  if (wrongTimingCount >= 1) return 7;
  if (dismissedCount >= 2 || notHelpfulCount >= 2) return 14;
  return 0;
}

function suppressionForInsightType(insightType, feedbackSummary = new Map()) {
  const stats = feedbackSummary.get(insightType);
  if (!stats) return { suppressed: false, cooldown_days: 0, reason: null, until: null };

  const cooldownDays = suppressionWindowDays(insightType, stats);
  if (!cooldownDays) return { suppressed: false, cooldown_days: 0, reason: null, until: null };

  const recentNegativeDays = daysSince(stats.last_negative_at);
  if (recentNegativeDays == null || recentNegativeDays > cooldownDays) {
    return { suppressed: false, cooldown_days: cooldownDays, reason: null, until: null };
  }

  const lastNegativeAt = new Date(stats.last_negative_at);
  const until = Number.isNaN(lastNegativeAt.getTime())
    ? null
    : new Date(lastNegativeAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000).toISOString();

  const reasons = stats.reasons || {};
  const topReason = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || (stats.dismissed >= 2 ? 'dismissed' : 'not_helpful');

  return {
    suppressed: true,
    cooldown_days: cooldownDays,
    reason: topReason,
    until,
  };
}

function shouldSuppressInsight(insight, feedbackSummary = new Map()) {
  return suppressionForInsightType(insight?.type, feedbackSummary).suppressed;
}

function feedbackAdjustmentForInsight(insight, feedbackSummary) {
  const stats = feedbackSummary.get(insight.type);
  if (!stats) return 0;

  let score = 0;
  score += stats.helpful * 2.5;
  score += stats.tapped * 0.75;
  score -= stats.not_helpful * 3;
  score -= stats.dismissed * 2;

  if (isPositiveOpportunityType(insight.type)) {
    score += stats.helpful * 1;
    score -= (stats.reasons.already_knew || 0) * 2.5;
    score -= (stats.reasons.not_relevant || 0) * 1.5;
  }

  if (stats.shown >= 3 && stats.tapped === 0 && stats.helpful === 0) {
    score -= 1.5;
  }

  score -= (stats.reasons.not_relevant || 0) * 2;
  score -= (stats.reasons.not_accurate || 0) * 2.5;
  score -= (stats.reasons.already_knew || 0) * 1.5;
  score -= (stats.reasons.wrong_timing || 0) * 1;

  const recentNegativeDays = daysSince(stats.last_negative_at);
  if (recentNegativeDays != null && recentNegativeDays <= 14) {
    score -= 2.5;
  }

  const recentHelpfulDays = daysSince(stats.last_helpful_at);
  if (recentHelpfulDays != null && recentHelpfulDays <= 14) {
    score += 1.5;
  }

  return score;
}

function toSerializableSummary(feedbackSummary) {
  return [...feedbackSummary.entries()]
    .map(([insightType, stats]) => ({
      insight_type: insightType,
      helpful: stats.helpful || 0,
      not_helpful: stats.not_helpful || 0,
      tapped: stats.tapped || 0,
      dismissed: stats.dismissed || 0,
      shown: stats.shown || 0,
      reasons: stats.reasons || {},
      last_negative_at: stats.last_negative_at || null,
      last_helpful_at: stats.last_helpful_at || null,
      suppression: suppressionForInsightType(insightType, feedbackSummary),
    }))
    .sort((a, b) => {
      const aSignal = (a.helpful + a.tapped) - (a.not_helpful + a.dismissed);
      const bSignal = (b.helpful + b.tapped) - (b.not_helpful + b.dismissed);
      if (bSignal !== aSignal) return bSignal - aSignal;
      return (b.shown + b.tapped + b.helpful + b.not_helpful + b.dismissed) - (a.shown + a.tapped + a.helpful + a.not_helpful + a.dismissed);
    });
}

function extractRecentNotes(events = [], limit = 20) {
  return events
    .filter((event) => `${event?.metadata?.note || ''}`.trim())
    .slice(0, limit)
    .map((event) => ({
      insight_id: event.insight_id,
      insight_type: normalizeInsightType(event),
      event_type: event.event_type,
      reason: event?.metadata?.reason || null,
      note: `${event?.metadata?.note || ''}`.trim(),
      surface: event?.metadata?.surface || null,
      created_at: event.created_at,
    }));
}

function buildFeedbackDebugSummary(events = []) {
  const summary = summarizeFeedbackEvents(events);
  return {
    insight_types: toSerializableSummary(summary),
    recent_notes: extractRecentNotes(events),
    totals: events.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  isPositiveOpportunityType,
  normalizeInsightType,
  summarizeFeedbackEvents,
  feedbackAdjustmentForInsight,
  suppressionForInsightType,
  shouldSuppressInsight,
  toSerializableSummary,
  extractRecentNotes,
  buildFeedbackDebugSummary,
};
