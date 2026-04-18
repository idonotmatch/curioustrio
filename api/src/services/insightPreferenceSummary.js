const { normalizeLineageKey } = require('./insightFeedbackSummary');

function createBucket() {
  return { shown: 0, positive: 0, negative: 0, score: 0 };
}

function bucketScore(bucket = {}) {
  const shown = Number(bucket.shown || 0);
  const positive = Number(bucket.positive || 0);
  const negative = Number(bucket.negative || 0);
  if (shown <= 0) return 0;
  return ((positive * 2) - (negative * 2)) / shown;
}

function topPreference(buckets = {}) {
  const rows = Object.entries(buckets)
    .map(([key, bucket]) => ({
      key,
      ...bucket,
      score: bucketScore(bucket),
    }))
    .filter((row) => row.shown > 0)
    .sort((a, b) => b.score - a.score || b.shown - a.shown || a.key.localeCompare(b.key));

  return rows[0] || null;
}

function summarizePreferenceRows(rows = [], minShown = 2) {
  return rows
    .map((row) => ({
      ...row,
      score: bucketScore(row),
    }))
    .filter((row) => row.shown >= minShown)
    .sort((a, b) => b.score - a.score || b.shown - a.shown || a.key.localeCompare(b.key));
}

function roleForInsightType(insightType = '') {
  const type = `${insightType || ''}`.trim();
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

  if (
    type === 'usage_start_logging'
    || type === 'usage_set_budget'
    || type === 'usage_building_history'
    || type === 'early_cleanup'
  ) return 'setup';

  return 'other';
}

function buildInsightPreferenceSummary(events = [], { outcomeWindows = [] } = {}) {
  const scopeBuckets = {
    personal: createBucket(),
    household: createBucket(),
  };
  const maturityBuckets = {
    early: createBucket(),
    developing: createBucket(),
    mature: createBucket(),
  };
  const roleBuckets = {
    act: createBucket(),
    plan: createBucket(),
    explain: createBucket(),
    setup: createBucket(),
  };
  const typeBuckets = new Map();

  for (const event of events) {
    const metadata = event?.metadata || {};
    const eventType = `${event?.event_type || ''}`.trim();
    const insightType = `${metadata.type || metadata.insight_type || ''}`.trim();
    const scope = `${metadata.scope || ''}`.trim();
    const maturity = `${metadata.maturity || ''}`.trim();
    const role = roleForInsightType(insightType);
    const lineageKey = normalizeLineageKey(event);

    if (eventType === 'shown') {
      if (scopeBuckets[scope]) scopeBuckets[scope].shown += 1;
      if (maturityBuckets[maturity]) maturityBuckets[maturity].shown += 1;
      if (roleBuckets[role]) roleBuckets[role].shown += 1;
      if (insightType) {
        const current = typeBuckets.get(insightType) || createBucket();
        current.shown += 1;
        typeBuckets.set(insightType, current);
      }
      continue;
    }

    const isPositive = eventType === 'tapped' || eventType === 'helpful' || eventType === 'acted';
    const isNegative = eventType === 'dismissed' || eventType === 'not_helpful';
    if (!isPositive && !isNegative) continue;

    const applySignal = (bucket) => {
      if (!bucket) return;
      if (isPositive) bucket.positive += 1;
      if (isNegative) bucket.negative += 1;
    };

    applySignal(scopeBuckets[scope]);
    applySignal(maturityBuckets[maturity]);
    applySignal(roleBuckets[role]);

    if (insightType) {
      const current = typeBuckets.get(insightType) || createBucket();
      applySignal(current);
      typeBuckets.set(insightType, current);
    }

    if (lineageKey === 'personal_with_household_context') {
      applySignal(scopeBuckets.personal);
    }
  }

  for (const window of outcomeWindows) {
    if (window?.status !== 'expired_no_action') continue;
    const insightType = `${window?.type || window?.insight_type || ''}`.trim();
    const scope = `${window?.scope || ''}`.trim();
    const maturity = `${window?.maturity || ''}`.trim();
    const role = roleForInsightType(insightType);

    const applyExpiredNoAction = (bucket) => {
      if (!bucket) return;
      bucket.negative += 1;
    };

    applyExpiredNoAction(scopeBuckets[scope]);
    applyExpiredNoAction(maturityBuckets[maturity]);
    applyExpiredNoAction(roleBuckets[role]);

    if (insightType) {
      const current = typeBuckets.get(insightType) || createBucket();
      current.negative += 1;
      typeBuckets.set(insightType, current);
    }
  }

  const scopePreferences = summarizePreferenceRows(
    Object.entries(scopeBuckets).map(([key, bucket]) => ({ key, ...bucket }))
  );
  const maturityPreferences = summarizePreferenceRows(
    Object.entries(maturityBuckets).map(([key, bucket]) => ({ key, ...bucket }))
  );
  const rolePreferences = summarizePreferenceRows(
    Object.entries(roleBuckets).map(([key, bucket]) => ({ key, ...bucket }))
  );
  const typePreferences = summarizePreferenceRows(
    [...typeBuckets.entries()].map(([key, bucket]) => ({ key, ...bucket })),
    1
  ).slice(0, 12);

  return {
    scope_preferences: scopePreferences,
    maturity_preferences: maturityPreferences,
    role_preferences: rolePreferences,
    type_preferences: typePreferences,
    expired_no_action_count: outcomeWindows.filter((window) => window?.status === 'expired_no_action').length,
    preferred_scope: topPreference(scopeBuckets)?.key || null,
    preferred_maturity: topPreference(maturityBuckets)?.key || null,
    preferred_role: topPreference(roleBuckets)?.key || null,
  };
}

function preferenceAdjustmentForInsight(insight, preferenceSummary = {}) {
  const metadata = insight?.metadata || {};
  const scope = `${metadata.scope || ''}`.trim();
  const maturity = `${metadata.maturity || ''}`.trim();
  const type = `${insight?.type || ''}`.trim();
  const role = roleForInsightType(type);

  let score = 0;

  const scopePreference = (preferenceSummary.scope_preferences || []).find((entry) => entry.key === scope);
  if (scopePreference) score += scopePreference.score * 6;

  const maturityPreference = (preferenceSummary.maturity_preferences || []).find((entry) => entry.key === maturity);
  if (maturityPreference) score += maturityPreference.score * 4;

  const rolePreference = (preferenceSummary.role_preferences || []).find((entry) => entry.key === role);
  if (rolePreference) score += rolePreference.score * 5;

  const typePreference = (preferenceSummary.type_preferences || []).find((entry) => entry.key === type);
  if (typePreference) score += typePreference.score * 3;

  return Number(score.toFixed(4));
}

function shouldSendPushForInsight(insight, preferenceSummary = {}) {
  const metadata = insight?.metadata || {};
  const scope = `${metadata.scope || ''}`.trim();
  const maturity = `${metadata.maturity || ''}`.trim();
  const type = `${insight?.type || ''}`.trim();
  const role = roleForInsightType(type);

  const typePreference = (preferenceSummary.type_preferences || []).find((entry) => entry.key === type);
  if (typePreference && typePreference.shown >= 2 && typePreference.score <= -1) {
    return false;
  }

  const rolePreference = (preferenceSummary.role_preferences || []).find((entry) => entry.key === role);
  if (rolePreference && rolePreference.shown >= 3 && rolePreference.score <= -0.75) {
    return false;
  }

  const scopePreference = (preferenceSummary.scope_preferences || []).find((entry) => entry.key === scope);
  if (scopePreference && scopePreference.shown >= 3 && scopePreference.score <= -0.75) {
    return false;
  }

  const maturityPreference = (preferenceSummary.maturity_preferences || []).find((entry) => entry.key === maturity);
  if (maturityPreference && maturityPreference.shown >= 3 && maturityPreference.score <= -1) {
    return false;
  }

  return true;
}

module.exports = {
  buildInsightPreferenceSummary,
  preferenceAdjustmentForInsight,
  roleForInsightType,
  shouldSendPushForInsight,
};
