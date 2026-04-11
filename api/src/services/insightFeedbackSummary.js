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

function inferredMaturityForInsightType(insightType) {
  const type = `${insightType || ''}`.trim();
  if (type.startsWith('early_')) return 'early';
  if (type.startsWith('developing_')) return 'developing';
  return null;
}

function normalizeOutcomeType(event = {}) {
  const raw = event?.metadata?.outcome_type
    || event?.metadata?.action_type
    || event?.metadata?.outcome
    || event?.metadata?.action;
  return `${raw || ''}`.trim();
}

function normalizeLineageKey(source = {}) {
  const hierarchyLevel = `${source?.metadata?.hierarchy_level || source?.hierarchy_level || ''}`.trim();
  if (hierarchyLevel) return hierarchyLevel;

  const scopeOrigin = `${source?.metadata?.scope_origin || source?.scope_origin || ''}`.trim();
  const rollsUp = source?.metadata?.rolls_up_from_personal ?? source?.rolls_up_from_personal;
  if (scopeOrigin === 'household') return 'household_rollup';
  if (scopeOrigin === 'personal' && rollsUp) return 'personal_with_household_context';
  if (scopeOrigin === 'personal') return 'personal';
  return 'default';
}

function createEmptyStats() {
  return {
    helpful: 0,
    not_helpful: 0,
    tapped: 0,
    dismissed: 0,
    acted: 0,
    shown: 0,
    reasons: {},
    outcomes: {},
    reviews: {},
    last_negative_at: null,
    last_helpful_at: null,
    last_acted_at: null,
  };
}

function mergeStatCounts(base = {}, extra = {}) {
  const mergeBuckets = (left = {}, right = {}) => {
    const merged = { ...(left || {}) };
    for (const [key, value] of Object.entries(right || {})) {
      merged[key] = Number(merged[key] || 0) + Number(value || 0);
    }
    return merged;
  };

  return {
    helpful: Number(base.helpful || 0) + Number(extra.helpful || 0),
    not_helpful: Number(base.not_helpful || 0) + Number(extra.not_helpful || 0),
    tapped: Number(base.tapped || 0) + Number(extra.tapped || 0),
    dismissed: Number(base.dismissed || 0) + Number(extra.dismissed || 0),
    acted: Number(base.acted || 0) + Number(extra.acted || 0),
    shown: Number(base.shown || 0) + Number(extra.shown || 0),
    reasons: mergeBuckets(base.reasons, extra.reasons),
    outcomes: mergeBuckets(base.outcomes, extra.outcomes),
    reviews: mergeBuckets(base.reviews, extra.reviews),
    last_negative_at: extra.last_negative_at || base.last_negative_at || null,
    last_helpful_at: extra.last_helpful_at || base.last_helpful_at || null,
    last_acted_at: extra.last_acted_at || base.last_acted_at || null,
  };
}

function summarizeFeedbackEvents(events = []) {
  const summary = new Map();

  for (const event of events) {
    const insightType = normalizeInsightType(event);
    if (!insightType) continue;

    const current = summary.get(insightType) || {
      ...createEmptyStats(),
      lineage: {},
    };
    const lineageKey = normalizeLineageKey(event);
    const lineageStats = current.lineage[lineageKey] || createEmptyStats();

    current[event.event_type] = (current[event.event_type] || 0) + 1;
    lineageStats[event.event_type] = (lineageStats[event.event_type] || 0) + 1;

    if (event.event_type === 'not_helpful') {
      const reason = `${event?.metadata?.reason || ''}`.trim();
      if (reason) {
        current.reasons[reason] = (current.reasons[reason] || 0) + 1;
        lineageStats.reasons[reason] = (lineageStats.reasons[reason] || 0) + 1;
      }
      current.last_negative_at = event.created_at || current.last_negative_at;
      lineageStats.last_negative_at = event.created_at || lineageStats.last_negative_at;
    }

    if (event.event_type === 'dismissed') {
      current.last_negative_at = event.created_at || current.last_negative_at;
      lineageStats.last_negative_at = event.created_at || lineageStats.last_negative_at;
    }

    if (event.event_type === 'helpful') {
      current.last_helpful_at = event.created_at || current.last_helpful_at;
      lineageStats.last_helpful_at = event.created_at || lineageStats.last_helpful_at;
    }

    if (event.event_type === 'acted') {
      const outcomeType = normalizeOutcomeType(event);
      if (outcomeType) {
        current.outcomes[outcomeType] = (current.outcomes[outcomeType] || 0) + 1;
        lineageStats.outcomes[outcomeType] = (lineageStats.outcomes[outcomeType] || 0) + 1;
      }
      const reviewType = `${event?.metadata?.review_type || ''}`.trim();
      const unusualReview = `${event?.metadata?.unusual_review || ''}`.trim();
      if (reviewType === 'unusual_purchase_review' && unusualReview) {
        current.reviews[unusualReview] = (current.reviews[unusualReview] || 0) + 1;
        lineageStats.reviews[unusualReview] = (lineageStats.reviews[unusualReview] || 0) + 1;
      }
      const categoryReview = `${event?.metadata?.category_review || ''}`.trim();
      if (reviewType === 'category_shift_review' && categoryReview) {
        current.reviews[categoryReview] = (current.reviews[categoryReview] || 0) + 1;
        lineageStats.reviews[categoryReview] = (lineageStats.reviews[categoryReview] || 0) + 1;
      }
      const recurringReview = `${event?.metadata?.recurring_review || ''}`.trim();
      if (reviewType === 'recurring_pressure_review' && recurringReview) {
        current.reviews[recurringReview] = (current.reviews[recurringReview] || 0) + 1;
        lineageStats.reviews[recurringReview] = (lineageStats.reviews[recurringReview] || 0) + 1;
      }
      current.last_acted_at = event.created_at || current.last_acted_at;
      lineageStats.last_acted_at = event.created_at || lineageStats.last_acted_at;
    }

    current.lineage[lineageKey] = lineageStats;
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
  const maturity = inferredMaturityForInsightType(insightType);

  if (maturity === 'early' || maturity === 'developing') {
    if (wrongTimingCount >= 1) return maturity === 'early' ? 4 : 6;
    if (notAccurateCount >= 2 || notRelevantCount >= 2 || notHelpfulCount >= 3) return maturity === 'early' ? 10 : 14;
    if (dismissedCount >= 2 || notHelpfulCount >= 2) return maturity === 'early' ? 7 : 10;
  }
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
  const baseStats = feedbackSummary.get(insight.type);
  if (!baseStats) return 0;
  const lineageKey = normalizeLineageKey(insight);
  const lineageStats = baseStats.lineage?.[lineageKey];
  const stats = lineageStats ? mergeStatCounts(baseStats, lineageStats) : baseStats;
  const actionRate = stats.shown > 0 ? stats.acted / stats.shown : 0;

  let score = 0;
  score += stats.helpful * 2.5;
  score += stats.tapped * 0.75;
  score += stats.acted * 4;
  score -= stats.not_helpful * 3;
  score -= stats.dismissed * 2;

  if (isPositiveOpportunityType(insight.type)) {
    score += stats.helpful * 1;
    score += stats.acted * 2;
    score -= (stats.reasons.already_knew || 0) * 2.5;
    score -= (stats.reasons.not_relevant || 0) * 1.5;
    if (stats.acted >= 2 && actionRate >= 0.25) {
      score += 3;
    }
    if (stats.shown >= 4 && stats.acted === 0 && stats.helpful === 0) {
      score -= 2;
    }
  }

  const maturity = `${insight?.metadata?.maturity || inferredMaturityForInsightType(insight.type) || ''}`.trim();
  if (maturity === 'early' || maturity === 'developing') {
    const wrongTiming = stats.reasons.wrong_timing || 0;
    const alreadyKnew = stats.reasons.already_knew || 0;
    const notRelevant = stats.reasons.not_relevant || 0;
    const notAccurate = stats.reasons.not_accurate || 0;
    const usefulRate = stats.shown > 0 ? (stats.helpful + stats.acted + stats.tapped * 0.4) / stats.shown : 0;

    score += stats.helpful * (maturity === 'early' ? 1.5 : 1);
    score += stats.acted * 1.5;
    score -= wrongTiming * (maturity === 'early' ? 4 : 3);
    score -= alreadyKnew * (maturity === 'early' ? 3 : 2);
    score -= notRelevant * 2;
    score -= notAccurate * 3;

    if (stats.shown >= 3 && usefulRate >= 0.35) score += maturity === 'early' ? 3 : 2;
    if (stats.shown >= 3 && stats.tapped === 0 && stats.helpful === 0 && stats.acted === 0) {
      score -= maturity === 'early' ? 4 : 3;
    }
  }

  if (stats.shown >= 3 && stats.tapped === 0 && stats.helpful === 0) {
    score -= 1.5;
  }

  if (insight.type === 'one_offs_driving_variance' || insight.type === 'one_off_expense_skewing_projection') {
    score += (stats.reviews.truly_one_off || 0) * 2.5;
    score -= (stats.reviews.expected || 0) * 7;
    score -= (stats.reviews.becoming_normal || 0) * 8;
  }

  if (
    insight.type === 'top_category_driver'
    || insight.type === 'projected_category_surge'
    || insight.type === 'projected_category_under_baseline'
  ) {
    score += (stats.reviews.temporary_swing || 0) * 1.5;
    score -= (stats.reviews.expected_pattern || 0) * 7;
    score += (stats.reviews.new_pattern || 0) * 2.5;
  }

  if (insight.type === 'recurring_cost_pressure') {
    score += (stats.reviews.temporary_spike || 0) * 1.5;
    score -= (stats.reviews.expected_cost || 0) * 7;
    score += (stats.reviews.new_pressure || 0) * 3;
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

  const recentActedDays = daysSince(stats.last_acted_at);
  if (recentActedDays != null && recentActedDays <= 21) {
    score += 2;
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
      acted: stats.acted || 0,
      shown: stats.shown || 0,
      reasons: stats.reasons || {},
      outcomes: stats.outcomes || {},
      reviews: stats.reviews || {},
      lineage: stats.lineage || {},
      lineage_summary: Object.entries(stats.lineage || {})
        .map(([lineageKey, lineageStats]) => ({
          lineage_key: lineageKey,
          shown: lineageStats.shown || 0,
          helpful: lineageStats.helpful || 0,
          not_helpful: lineageStats.not_helpful || 0,
          dismissed: lineageStats.dismissed || 0,
          acted: lineageStats.acted || 0,
          net_signal: (lineageStats.helpful || 0) + (lineageStats.acted || 0) + (lineageStats.tapped || 0)
            - (lineageStats.not_helpful || 0) - (lineageStats.dismissed || 0),
        }))
        .sort((a, b) => b.net_signal - a.net_signal || b.acted - a.acted || b.helpful - a.helpful),
      last_negative_at: stats.last_negative_at || null,
      last_helpful_at: stats.last_helpful_at || null,
      last_acted_at: stats.last_acted_at || null,
      suppression: suppressionForInsightType(insightType, feedbackSummary),
    }))
    .sort((a, b) => {
      const aSignal = (a.helpful + a.tapped + a.acted) - (a.not_helpful + a.dismissed);
      const bSignal = (b.helpful + b.tapped + b.acted) - (b.not_helpful + b.dismissed);
      if (bSignal !== aSignal) return bSignal - aSignal;
      return (b.shown + b.tapped + b.helpful + b.acted + b.not_helpful + b.dismissed) - (a.shown + a.tapped + a.helpful + a.acted + a.not_helpful + a.dismissed);
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
  const topOutcomeTypes = [...summary.entries()]
    .map(([insightType, stats]) => ({
      insight_type: insightType,
      acted: stats.acted || 0,
      outcomes: stats.outcomes || {},
    }))
    .filter((row) => row.acted > 0)
    .sort((a, b) => b.acted - a.acted)
    .slice(0, 10);
  const topLineageTypes = toSerializableSummary(summary)
    .flatMap((row) => (row.lineage_summary || []).map((lineage) => ({
      insight_type: row.insight_type,
      lineage_key: lineage.lineage_key,
      shown: lineage.shown,
      helpful: lineage.helpful,
      not_helpful: lineage.not_helpful,
      dismissed: lineage.dismissed,
      acted: lineage.acted,
      net_signal: lineage.net_signal,
    })))
    .filter((row) => row.shown > 0 || row.helpful > 0 || row.not_helpful > 0 || row.dismissed > 0 || row.acted > 0)
    .sort((a, b) => b.net_signal - a.net_signal || b.acted - a.acted || b.helpful - a.helpful)
    .slice(0, 15);

  return {
    insight_types: toSerializableSummary(summary),
    top_outcome_types: topOutcomeTypes,
    top_lineage_types: topLineageTypes,
    recent_notes: extractRecentNotes(events),
    totals: events.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {}),
  };
}

module.exports = {
  isPositiveOpportunityType,
  inferredMaturityForInsightType,
  normalizeInsightType,
  normalizeOutcomeType,
  normalizeLineageKey,
  summarizeFeedbackEvents,
  feedbackAdjustmentForInsight,
  suppressionForInsightType,
  shouldSuppressInsight,
  toSerializableSummary,
  extractRecentNotes,
  buildFeedbackDebugSummary,
};
