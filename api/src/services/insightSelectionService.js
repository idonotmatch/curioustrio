const { feedbackAdjustmentForInsight, normalizeLineageKey } = require('./insightFeedbackSummary');
const { preferenceAdjustmentForInsight } = require('./insightPreferenceSummary');
const { severityRank, insightDestinationAdjustment } = require('./insightPortfolio');

function confidenceComponentScore(insight) {
  const confidence = `${insight?.metadata?.confidence || ''}`.trim();
  if (confidence === 'comparative') return 12;
  if (confidence === 'descriptive') return 8;
  if (confidence === 'observed') return 10;
  return 0;
}

function historicalEvidenceScore(insight) {
  const count = Number(insight?.metadata?.historical_period_count || 0);
  if (count >= 6) return 24;
  if (count >= 4) return 20;
  if (count >= 3) return 16;
  if (count >= 2) return 10;
  if (count >= 1) return 4;
  return 0;
}

function numericEvidenceScore(insight) {
  const metadata = insight?.metadata || {};
  const absoluteValues = [
    Math.abs(Number(metadata.projected_budget_delta || 0)),
    Math.abs(Number(metadata.projected_headroom_amount || 0)),
    Math.abs(Number(metadata.projected_over_under || 0)),
    Math.abs(Number(metadata.delta_amount || 0)),
    Math.abs(Number(metadata.one_off_delta_amount || 0)),
    Math.abs(Number(metadata.total_delta_amount || 0)),
    Math.abs(Number(metadata.current_spend_to_date || 0)),
    Math.abs(Number(metadata.current_spend || 0)),
  ];
  const strongestAmount = Math.max(...absoluteValues);
  const strongestPercent = Math.max(
    Math.abs(Number(metadata.delta_percent || 0)),
    Math.abs(Number(metadata.share_of_spend || 0)),
    Math.abs(Number(metadata.budget_used_percent || 0)),
    Math.abs(Number(metadata.discount_percent || 0))
  );

  let score = 0;

  if (strongestAmount >= 200) score += 18;
  else if (strongestAmount >= 100) score += 14;
  else if (strongestAmount >= 50) score += 10;
  else if (strongestAmount >= 20) score += 6;

  if (strongestPercent >= 30) score += 14;
  else if (strongestPercent >= 15) score += 10;
  else if (strongestPercent >= 8) score += 6;

  const expenseCount = Number(metadata.expense_count || metadata.merchant_count || metadata.occurrence_count || 0);
  if (expenseCount >= 5) score += 8;
  else if (expenseCount >= 3) score += 5;
  else if (expenseCount >= 1) score += 2;

  return Math.min(score, 36);
}

function parseInsightAnchorDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function daysSince(value) {
  const date = parseInsightAnchorDate(value);
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function temporalRelevanceScore(insight) {
  const metadata = insight?.metadata || {};
  const type = `${insight?.type || ''}`.trim();

  if (type === 'recurring_repurchase_due') {
    const daysUntilDue = Number(metadata.days_until_due);
    if (!Number.isFinite(daysUntilDue)) return 0;
    if (daysUntilDue <= 0) return 18;
    if (daysUntilDue <= 2) return 14;
    if (daysUntilDue <= 5) return 10;
    if (daysUntilDue <= 10) return 4;
    return 0;
  }

  if (type === 'recurring_restock_window') {
    const daysUntilDue = Number(metadata.days_until_due);
    if (!Number.isFinite(daysUntilDue)) return 0;
    if (daysUntilDue <= 1) return 14;
    if (daysUntilDue <= 4) return 10;
    if (daysUntilDue <= 7) return 6;
    return 2;
  }

  if (type === 'buy_soon_better_price') {
    const observedAge = daysSince(metadata.observed_at);
    if (observedAge == null) return 0;
    if (observedAge <= 1) return 16;
    if (observedAge <= 3) return 12;
    if (observedAge <= 7) return 6;
    return 0;
  }

  if (
    type === 'recurring_price_spike'
    || type === 'recurring_better_than_usual'
    || type === 'recurring_cheaper_elsewhere'
    || type === 'recurring_cost_pressure'
    || type === 'item_merchant_variance'
    || type === 'item_staple_merchant_opportunity'
    || type === 'item_staple_emerging'
  ) {
    const recentAge = daysSince(metadata.latest_date || metadata.last_purchased_at);
    if (recentAge == null) return 0;
    if (recentAge <= 3) return 12;
    if (recentAge <= 7) return 8;
    if (recentAge <= 14) return 4;
    return 0;
  }

  return 0;
}

function evidenceStrengthScore(insight) {
  return historicalEvidenceScore(insight) + confidenceComponentScore(insight) + numericEvidenceScore(insight);
}

function categoryTrustAdjustment(insight) {
  const type = `${insight?.type || ''}`.trim();
  const categoryDriven = type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
    || type === 'early_top_category'
    || type === 'developing_category_shift';
  if (!categoryDriven) return 0;

  const trustScore = Number(insight?.metadata?.category_trust_score ?? NaN);
  const lowConfidenceCount = Number(insight?.metadata?.category_low_confidence_count || 0);
  const trustedCount = Number(insight?.metadata?.category_trusted_count || 0);

  let adjustment = 0;
  if (Number.isFinite(trustScore)) {
    if (trustScore >= 0.9) adjustment += 10;
    else if (trustScore >= 0.8) adjustment += 6;
    else if (trustScore >= 0.7) adjustment += 2;
    else if (trustScore >= 0.55) adjustment -= 8;
    else adjustment -= 16;
  }

  if (lowConfidenceCount >= 3 && trustedCount === 0) adjustment -= 8;
  else if (lowConfidenceCount >= 2 && trustedCount <= 1) adjustment -= 4;

  return adjustment;
}

function scopeRelevanceScore(insight) {
  if (insight?.metadata?.scope_relationship === 'personal_household_overlap') return 14;
  if (insight?.metadata?.scope === 'personal') return 16;
  if (insight?.metadata?.scope === 'household') return 6;
  return 0;
}

function knownTypeShownCount(typePreferences = [], insightType = '') {
  const type = `${insightType || ''}`.trim();
  if (!type) return 0;
  const match = typePreferences.find((entry) => entry.key === type);
  return Number(match?.shown || 0);
}

function noveltyScore(insight, preferenceSummary = {}) {
  const shownCount = knownTypeShownCount(preferenceSummary.type_preferences, insight?.type);
  if (shownCount === 0) return 18;
  if (shownCount === 1) return 14;
  if (shownCount === 2) return 8;
  if (shownCount <= 4) return 4;
  return 0;
}

function severityComponentScore(insight) {
  const severity = `${insight?.severity || ''}`.trim();
  if (severity === 'high') return 120;
  if (severity === 'medium') return 90;
  return 60;
}

function maturityComponentScore(insight) {
  const maturity = `${insight?.metadata?.maturity || ''}`.trim();
  if (maturity === 'mature') return 35;
  if (maturity === 'developing') return 25;
  if (maturity === 'early') return 18;
  return 12;
}

function portfolioRole(insight) {
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'usage_start_logging'
    || type === 'usage_set_budget'
    || type === 'usage_building_history'
    || type === 'early_cleanup'
  ) return 'setup';

  if (
    type === 'projected_month_end_over_budget'
    || type === 'budget_too_low'
    || type === 'recurring_repurchase_due'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
    || type === 'item_merchant_variance'
    || type === 'item_staple_merchant_opportunity'
  ) return 'act';

  if (
    type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'usage_ready_to_plan'
  ) return 'plan';

  if (
    type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'recurring_cost_pressure'
    || type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'budget_too_high'
    || type === 'early_budget_pace'
    || type === 'early_top_category'
    || type === 'early_repeated_merchant'
    || type === 'early_spend_concentration'
    || type === 'early_logging_momentum'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
    || type === 'item_staple_emerging'
  ) return 'explain';

  return 'other';
}

function actionabilityScore(insight) {
  const role = portfolioRole(insight);
  if (role === 'act') return 42;
  if (role === 'plan') return 36;
  if (role === 'setup') return 28;
  if (role === 'explain') return 18;
  return 10;
}

function minimumSurfaceThreshold(insight) {
  const maturity = `${insight?.metadata?.maturity || ''}`.trim() || 'unknown';
  const role = portfolioRole(insight);

  if (maturity === 'mature') {
    if (role === 'act' || role === 'plan') return 170;
    if (role === 'setup') return 158;
    if (role === 'explain') return 160;
    return 150;
  }

  if (maturity === 'developing') {
    if (role === 'act' || role === 'plan') return 148;
    if (role === 'setup') return 138;
    if (role === 'explain') return 140;
    return 132;
  }

  if (maturity === 'early') {
    if (role === 'setup') return 126;
    if (role === 'act' || role === 'plan') return 132;
    if (role === 'explain') return 130;
    return 124;
  }

  return 145;
}

function surfaceGuardReasons(insight, preferenceSummary = {}) {
  const metadata = insight?.metadata || {};
  const reasons = [];
  const type = `${insight?.type || ''}`.trim();
  const role = portfolioRole(insight);
  const maturity = `${metadata.maturity || ''}`.trim();
  const shownCount = knownTypeShownCount(preferenceSummary.type_preferences, insight?.type);
  const evidenceScore = evidenceStrengthScore(insight);

  if ((metadata.merchant_key === 'unknown' || metadata.merchant_name === 'Unknown merchant') && metadata.merchant_key) {
    reasons.push('unknown_merchant_anchor');
  }

  if (role === 'explain' && evidenceScore < 18) {
    reasons.push('thin_explanatory_evidence');
  }

  if (
    (type === 'top_category_driver'
      || type === 'projected_category_surge'
      || type === 'projected_category_under_baseline'
      || type === 'early_top_category'
      || type === 'developing_category_shift')
    && Number.isFinite(Number(metadata.category_trust_score))
    && Number(metadata.category_trust_score) < 0.55
  ) {
    reasons.push('weak_category_assignment_signal');
  }

  if (maturity === 'early' && role === 'explain') {
    const hasAnchor = Boolean(
      metadata.category_key
      || metadata.merchant_key
      || metadata.delta_amount
      || metadata.current_spend_to_date
      || metadata.expense_count
      || metadata.merchant_count
      || metadata.uncategorized_count
    );
    if (!hasAnchor) reasons.push('early_signal_missing_anchor');
  }

  if (shownCount >= 6 && severityRank(insight?.severity) <= 1 && evidenceScore < 24) {
    reasons.push('stale_low_signal');
  }

  return reasons;
}

function scopeHierarchyAdjustment(insight) {
  const scope = insight?.metadata?.scope;
  if (scope === 'personal') return 18;
  if (scope === 'household') return 4;
  return 0;
}

function scoreInsightCandidate(insight, feedbackSummary = new Map(), preferenceSummary = {}) {
  const components = {
    severity: severityComponentScore(insight),
    maturity: maturityComponentScore(insight),
    actionability: actionabilityScore(insight),
    evidence: evidenceStrengthScore(insight),
    temporal_relevance: temporalRelevanceScore(insight),
    scope_relevance: scopeRelevanceScore(insight),
    destination: insightDestinationAdjustment(insight) * 4,
    novelty: noveltyScore(insight, preferenceSummary),
  };
  const adjustments = {
    feedback: feedbackAdjustmentForInsight(insight, feedbackSummary),
    preference: preferenceAdjustmentForInsight(insight, preferenceSummary),
    scope_hierarchy: scopeHierarchyAdjustment(insight),
    planner_timing: Number(insight?.metadata?.planner_timing_adjustment || 0),
    category_trust: categoryTrustAdjustment(insight),
  };
  const baseScore = Object.values(components).reduce((sum, value) => sum + Number(value || 0), 0);
  const adjustmentScore = Object.values(adjustments).reduce((sum, value) => sum + Number(value || 0), 0);
  const surfaceScore = baseScore + adjustmentScore;
  const threshold = minimumSurfaceThreshold(insight);
  const guardReasons = surfaceGuardReasons(insight, preferenceSummary);

  return {
    components,
    adjustments,
    base_score: baseScore,
    adjustment_score: adjustmentScore,
    surface_score: surfaceScore,
    threshold,
    eligible: guardReasons.length === 0 && surfaceScore >= threshold,
    suppression_reasons: [
      ...guardReasons,
      ...(surfaceScore >= threshold ? [] : ['below_surface_threshold']),
    ],
  };
}

function insightRankScore(insight, feedbackSummary = new Map(), preferenceSummary = {}) {
  return scoreInsightCandidate(insight, feedbackSummary, preferenceSummary).surface_score;
}

function insightSurfaceDecision(insight, feedbackSummary = new Map(), preferenceSummary = {}) {
  return scoreInsightCandidate(insight, feedbackSummary, preferenceSummary);
}

function promoteExplorationCandidate(ranked = [], preferenceSummary = {}, limit = 10) {
  if (!Array.isArray(ranked) || ranked.length <= 1 || limit < 3) return ranked;

  const topWindow = ranked.slice(0, limit);
  if (!topWindow.length) return ranked;

  const hasLowHistoryTypeInWindow = topWindow.some((insight) => (
    knownTypeShownCount(preferenceSummary.type_preferences, insight?.type) < 2
  ));
  if (hasLowHistoryTypeInWindow) return ranked;

  const windowTypes = new Set(topWindow.map((insight) => `${insight?.type || ''}`.trim()).filter(Boolean));
  const candidateIndex = ranked.findIndex((insight, index) => (
    index >= limit
    && knownTypeShownCount(preferenceSummary.type_preferences, insight?.type) < 2
    && !windowTypes.has(`${insight?.type || ''}`.trim())
  ));

  if (candidateIndex < 0) return ranked;

  const candidate = ranked[candidateIndex];
  const reordered = ranked.filter((_, index) => index !== candidateIndex);
  reordered.splice(Math.max(0, limit - 1), 0, candidate);
  return reordered;
}

function portfolioFamily(insight) {
  const type = `${insight?.type || ''}`.trim();
  if (!type) return 'other';

  if (
    type === 'spend_pace_ahead'
    || type === 'early_budget_pace'
    || type === 'budget_too_low'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_category_surge'
    || type === 'recurring_price_spike'
    || type === 'recurring_cost_pressure'
  ) return 'warning';

  if (
    type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'early_top_category'
    || type === 'early_repeated_merchant'
    || type === 'early_spend_concentration'
    || type === 'early_logging_momentum'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
    || type === 'item_staple_emerging'
  ) return 'explanation';

  if (
    type === 'projected_month_end_under_budget'
    || type === 'projected_category_under_baseline'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
    || type === 'item_merchant_variance'
    || type === 'item_staple_merchant_opportunity'
  ) return 'opportunity';

  if (
    type === 'recurring_repurchase_due'
    || type === 'spend_pace_behind'
    || type === 'budget_too_high'
    || type === 'early_cleanup'
  ) return 'reminder';

  return 'other';
}

function narrativeClusterKey(insight) {
  const scope = insight?.metadata?.scope || 'global';
  const month = insight?.metadata?.month || 'na';
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'top_category_driver'
    || type === 'one_offs_driving_variance'
    || type === 'early_budget_pace'
    || type === 'early_top_category'
    || type === 'early_repeated_merchant'
    || type === 'early_spend_concentration'
    || type === 'early_cleanup'
    || type === 'early_logging_momentum'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
    || type === 'item_staple_emerging'
  ) {
    return `trend:${scope}:${month}`;
  }

  if (
    type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'one_off_expense_skewing_projection'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
  ) {
    return `projection:${scope}:${month}`;
  }

  if (
    type === 'recurring_repurchase_due'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
    || type === 'recurring_cost_pressure'
    || type === 'item_merchant_variance'
    || type === 'item_staple_merchant_opportunity'
  ) {
    return `recurring:${scope}:${month}`;
  }

  if (
    type === 'budget_too_low'
    || type === 'budget_too_high'
  ) {
    return `budget:${scope}:${month}`;
  }

  return `${type}:${scope}:${month}`;
}

function narrativeTheme(insight) {
  return narrativeClusterKey(insight).split(':')[0] || 'other';
}

function aggregatePortfolioFeedback(feedbackSummary = new Map()) {
  const family = new Map();
  const theme = new Map();
  const familyLineage = new Map();
  const themeLineage = new Map();

  const addToBucket = (bucket, key, stats = {}) => {
    const current = bucket.get(key) || {
      shown: 0,
      helpful: 0,
      not_helpful: 0,
      dismissed: 0,
      acted: 0,
    };
    current.shown += Number(stats.shown || 0);
    current.helpful += Number(stats.helpful || 0);
    current.not_helpful += Number(stats.not_helpful || 0);
    current.dismissed += Number(stats.dismissed || 0);
    current.acted += Number(stats.acted || 0);
    bucket.set(key, current);
  };

  for (const [insightType, stats] of feedbackSummary.entries()) {
    const familyKey = portfolioFamily({ type: insightType });
    const themeKey = narrativeTheme({ type: insightType });

    addToBucket(family, familyKey, stats);
    addToBucket(theme, themeKey, stats);

    for (const [lineageKey, lineageStats] of Object.entries(stats.lineage || {})) {
      addToBucket(familyLineage, `${familyKey}:${lineageKey}`, lineageStats);
      addToBucket(themeLineage, `${themeKey}:${lineageKey}`, lineageStats);
    }
  }

  return { family, theme, familyLineage, themeLineage };
}

function portfolioBucketAdjustment(stats = {}) {
  const shown = Number(stats.shown || 0);
  const helpful = Number(stats.helpful || 0);
  const notHelpful = Number(stats.not_helpful || 0);
  const dismissed = Number(stats.dismissed || 0);
  const acted = Number(stats.acted || 0);

  let score = 0;
  score += helpful * 1.5;
  score += acted * 2.5;
  score -= notHelpful * 2;
  score -= dismissed * 1.25;

  if (shown >= 4 && acted === 0 && helpful === 0) score -= 3;
  if (shown >= 3 && acted / shown >= 0.25) score += 2;

  return score;
}

function portfolioOutcomeAdjustment(insight, portfolioFeedback = {
  family: new Map(),
  theme: new Map(),
  familyLineage: new Map(),
  themeLineage: new Map(),
}) {
  const lineageKey = normalizeLineageKey(insight);
  const familyStats = portfolioFeedback.family.get(portfolioFamily(insight));
  const themeStats = portfolioFeedback.theme.get(narrativeTheme(insight));
  const familyLineageStats = portfolioFeedback.familyLineage.get(`${portfolioFamily(insight)}:${lineageKey}`);
  const themeLineageStats = portfolioFeedback.themeLineage.get(`${narrativeTheme(insight)}:${lineageKey}`);
  return portfolioBucketAdjustment(familyStats)
    + portfolioBucketAdjustment(themeStats) * 0.75
    + portfolioBucketAdjustment(familyLineageStats) * 0.8
    + portfolioBucketAdjustment(themeLineageStats) * 0.5;
}

function orchestrationPenalty(insight, selected = []) {
  const family = portfolioFamily(insight);
  const sameFamilyCount = selected.filter((picked) => portfolioFamily(picked) === family).length;
  const selectedFamilies = new Set(selected.map((picked) => portfolioFamily(picked)));
  const clusterKey = narrativeClusterKey(insight);
  const sameEntityCount = selected.filter((picked) =>
    picked.entity_type === insight.entity_type
    && picked.entity_id
    && picked.entity_id === insight.entity_id
  ).length;
  const sameScopeCount = selected.filter((picked) =>
    picked.metadata?.scope
    && picked.metadata?.scope === insight.metadata?.scope
    && portfolioFamily(picked) === family
  ).length;
  const sameClusterCount = selected.filter((picked) => narrativeClusterKey(picked) === clusterKey).length;

  let penalty = 0;
  penalty += sameFamilyCount * 55;
  penalty += sameEntityCount * 35;
  penalty += sameScopeCount * 10;
  penalty += sameClusterCount * 70;

  if (sameFamilyCount > 0 && selectedFamilies.size < 3) {
    penalty += 90;
  }

  if (family === 'opportunity') penalty += sameFamilyCount * 20;
  if (family === 'explanation') penalty += sameFamilyCount * 15;

  return penalty;
}

function orchestrationRoleMixAdjustment(insight, selected = []) {
  const role = portfolioRole(insight);
  const selectedRoles = new Set(selected.map((picked) => portfolioRole(picked)));
  const sameRoleCount = selected.filter((picked) => portfolioRole(picked) === role).length;

  let score = 0;

  if (selected.length === 0) {
    if (role === 'act' || role === 'setup') score += 10;
    if (role === 'explain') score -= 4;
  }

  if (!selectedRoles.has(role)) {
    if (role === 'act' || role === 'plan' || role === 'setup') score += 14;
    else if (role === 'explain') score += 6;
  }

  if (role === 'explain' && !selectedRoles.has('act') && !selectedRoles.has('plan') && !selectedRoles.has('setup')) {
    score -= 8;
  }

  if (role === 'explain' && sameRoleCount > 0) score -= sameRoleCount * 10;
  if (role === 'setup' && sameRoleCount > 0) score -= sameRoleCount * 20;

  return score;
}

function orchestrationNarrativeRoleAdjustment(insight, candidates = [], selected = []) {
  const role = portfolioRole(insight);
  const clusterKey = narrativeClusterKey(insight);
  const themeKey = narrativeTheme(insight);
  const peers = candidates.filter((candidate) => candidate.id !== insight.id);
  const clusterPeers = peers.filter((candidate) => narrativeClusterKey(candidate) === clusterKey);
  const themePeers = peers.filter((candidate) => narrativeTheme(candidate) === themeKey);
  const clusterHasActionablePeer = clusterPeers.some((candidate) => {
    const candidateRole = portfolioRole(candidate);
    return candidateRole === 'act' || candidateRole === 'plan' || candidateRole === 'setup';
  });
  const themeHasActionablePeer = themePeers.some((candidate) => {
    const candidateRole = portfolioRole(candidate);
    return candidateRole === 'act' || candidateRole === 'plan' || candidateRole === 'setup';
  });
  const clusterHasExplainPeer = clusterPeers.some((candidate) => portfolioRole(candidate) === 'explain');
  const themeHasExplainPeer = themePeers.some((candidate) => portfolioRole(candidate) === 'explain');
  const selectedClusterHasActionable = selected.some((candidate) => {
    const candidateRole = portfolioRole(candidate);
    return narrativeClusterKey(candidate) === clusterKey
      && (candidateRole === 'act' || candidateRole === 'plan' || candidateRole === 'setup');
  });

  let score = 0;

  if (role === 'act' || role === 'plan' || role === 'setup') {
    if (clusterHasExplainPeer) score += 28;
    else if (themeHasExplainPeer) score += 10;
  }

  if (role === 'explain') {
    if (selectedClusterHasActionable) score -= 22;
    else if (clusterHasActionablePeer) score -= 30;
    else if (themeHasActionablePeer) score -= 12;
  }

  return score;
}

function orchestrateInsightPortfolio(insights, feedbackSummary = new Map(), limit = 10, preferenceSummary = {}) {
  const remaining = [...insights];
  const selected = [];
  const portfolioFeedback = aggregatePortfolioFeedback(feedbackSummary);

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const insight = remaining[i];
      const score = insightRankScore(insight, feedbackSummary, preferenceSummary)
        + portfolioOutcomeAdjustment(insight, portfolioFeedback)
        + orchestrationRoleMixAdjustment(insight, selected)
        + orchestrationNarrativeRoleAdjustment(insight, remaining, selected)
        - orchestrationPenalty(insight, selected);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function summarizeSurfaceDecisions(decisions = []) {
  const summary = {
    total: Array.isArray(decisions) ? decisions.length : 0,
    eligible: 0,
    suppressed: 0,
    by_reason: {},
    by_maturity: {},
    by_role: {},
  };

  for (const entry of decisions || []) {
    const scoring = entry?.scoring || {};
    const insight = entry?.insight || {};
    const maturity = `${insight?.metadata?.maturity || 'unknown'}`;
    const role = portfolioRole(insight);

    summary.by_maturity[maturity] = summary.by_maturity[maturity] || { eligible: 0, suppressed: 0 };
    summary.by_role[role] = summary.by_role[role] || { eligible: 0, suppressed: 0 };

    if (scoring.eligible) {
      summary.eligible += 1;
      summary.by_maturity[maturity].eligible += 1;
      summary.by_role[role].eligible += 1;
      continue;
    }

    summary.suppressed += 1;
    summary.by_maturity[maturity].suppressed += 1;
    summary.by_role[role].suppressed += 1;
    for (const reason of scoring.suppression_reasons || []) {
      summary.by_reason[reason] = (summary.by_reason[reason] || 0) + 1;
    }
  }

  return summary;
}

function compareRankingStrategies(insights = [], feedbackSummary = new Map(), preferenceSummary = {}, limit = 10) {
  const scored = (insights || []).map((insight) => {
    const scoring = insightSurfaceDecision(insight, feedbackSummary, preferenceSummary);
    return {
      insight,
      scoring,
      legacy_rank_score: severityRank(insight?.severity) * 100
        + feedbackAdjustmentForInsight(insight, feedbackSummary)
        + preferenceAdjustmentForInsight(insight, preferenceSummary),
    };
  });

  const legacyTop = [...scored]
    .sort((a, b) => {
      const diff = b.legacy_rank_score - a.legacy_rank_score;
      if (diff !== 0) return diff;
      return new Date(b.insight?.created_at || 0) - new Date(a.insight?.created_at || 0);
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.insight?.id,
      type: entry.insight?.type,
      title: entry.insight?.title,
      legacy_rank_score: entry.legacy_rank_score,
      surface_score: entry.scoring?.surface_score,
      eligible: entry.scoring?.eligible,
    }));

  const thresholdEligible = scored
    .filter((entry) => entry.scoring?.eligible)
    .sort((a, b) => {
      const diff = b.scoring.surface_score - a.scoring.surface_score;
      if (diff !== 0) return diff;
      return new Date(b.insight?.created_at || 0) - new Date(a.insight?.created_at || 0);
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.insight?.id,
      type: entry.insight?.type,
      title: entry.insight?.title,
      surface_score: entry.scoring?.surface_score,
      threshold: entry.scoring?.threshold,
    }));

  const suppressed = scored
    .filter((entry) => !entry.scoring?.eligible)
    .sort((a, b) => b.scoring.surface_score - a.scoring.surface_score)
    .map((entry) => ({
      id: entry.insight?.id,
      type: entry.insight?.type,
      title: entry.insight?.title,
      surface_score: entry.scoring?.surface_score,
      threshold: entry.scoring?.threshold,
      suppression_reasons: entry.scoring?.suppression_reasons || [],
    }));

  return {
    legacy_top: legacyTop,
    threshold_top: thresholdEligible,
    suppressed_candidates: suppressed,
  };
}

module.exports = {
  scoreInsightCandidate,
  insightSurfaceDecision,
  summarizeSurfaceDecisions,
  compareRankingStrategies,
  insightRankScore,
  scopeHierarchyAdjustment,
  promoteExplorationCandidate,
  portfolioRole,
  portfolioFamily,
  narrativeClusterKey,
  narrativeTheme,
  orchestrateInsightPortfolio,
};
