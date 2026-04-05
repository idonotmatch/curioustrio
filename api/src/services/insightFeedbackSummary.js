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

function feedbackAdjustmentForInsight(insight, feedbackSummary) {
  const stats = feedbackSummary.get(insight.type);
  if (!stats) return 0;

  let score = 0;
  score += stats.helpful * 2.5;
  score += stats.tapped * 0.75;
  score -= stats.not_helpful * 3;
  score -= stats.dismissed * 2;

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
  normalizeInsightType,
  summarizeFeedbackEvents,
  feedbackAdjustmentForInsight,
  toSerializableSummary,
  extractRecentNotes,
  buildFeedbackDebugSummary,
};
