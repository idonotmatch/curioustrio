function severityRank(severity) {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function insightDestinationAdjustment(insight) {
  const type = `${insight?.type || ''}`.trim();

  if (
    type === 'one_offs_driving_variance'
    || type === 'one_off_expense_skewing_projection'
    || type === 'recurring_cost_pressure'
  ) return 6;

  if (
    type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
    || type === 'early_top_category'
    || type === 'early_repeated_merchant'
    || type === 'early_spend_concentration'
    || type === 'early_logging_momentum'
    || type === 'developing_category_shift'
    || type === 'developing_repeated_merchant'
    || type === 'developing_weekly_spend_change'
  ) return 4;

  if (
    type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || type === 'budget_too_low'
    || type === 'budget_too_high'
    || type === 'usage_ready_to_plan'
  ) return 5;

  if (
    type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'early_budget_pace'
    || type === 'usage_set_budget'
    || type === 'usage_start_logging'
    || type === 'usage_building_history'
    || type === 'early_cleanup'
  ) return 1;

  return 0;
}

function maturityRankForInsight(insight) {
  const maturity = `${insight?.metadata?.maturity || ''}`.trim();
  if (maturity === 'mature') return 3;
  if (maturity === 'developing') return 2;
  if (maturity === 'early') return 1;
  return 0;
}

function insightContinuityKey(insight) {
  if (insight?.metadata?.continuity_key) return insight.metadata.continuity_key;

  const type = `${insight?.type || ''}`.trim();
  const scope = insight?.metadata?.scope || 'global';
  const month = insight?.metadata?.month || 'current';

  if (
    type === 'early_top_category'
    || type === 'developing_category_shift'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
  ) {
    const categoryKey = insight?.metadata?.category_key || insight?.entity_id;
    return categoryKey ? `category:${scope}:${categoryKey}` : null;
  }

  if (
    type === 'early_repeated_merchant'
    || type === 'developing_repeated_merchant'
  ) {
    const merchantKey = insight?.metadata?.merchant_key || insight?.entity_id;
    return merchantKey ? `merchant:${scope}:${merchantKey}` : null;
  }

  if (
    type === 'early_budget_pace'
    || type === 'developing_weekly_spend_change'
    || type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
  ) {
    return `budget_pace:${scope}:${month}`;
  }

  return null;
}

function scopeAgnosticContinuityKey(insight) {
  const key = insightContinuityKey(insight);
  if (!key) return null;
  return key.replace(/:(personal|household):/, ':shared:');
}

function isScopeConsolidatableInsight(insight) {
  const type = `${insight?.type || ''}`.trim();
  return [
    'early_budget_pace',
    'early_top_category',
    'early_repeated_merchant',
    'developing_weekly_spend_change',
    'developing_category_shift',
    'developing_repeated_merchant',
    'spend_pace_ahead',
    'spend_pace_behind',
    'top_category_driver',
    'projected_category_surge',
    'projected_category_under_baseline',
    'projected_month_end_over_budget',
    'projected_month_end_under_budget',
  ].includes(type);
}

function buildScopeLineageMetadata(metadata = {}) {
  const scope = metadata?.scope === 'household' ? 'household' : 'personal';
  const consolidatedScopes = Array.isArray(metadata?.consolidated_scopes)
    ? metadata.consolidated_scopes
    : [];
  const includesPersonal = consolidatedScopes.includes('personal') || scope === 'personal';
  const includesHousehold = consolidatedScopes.includes('household') || scope === 'household';

  if (includesPersonal && includesHousehold) {
    return {
      scope_origin: 'personal',
      rolls_up_from_personal: true,
      household_context_included: true,
      hierarchy_level: 'personal_with_household_context',
    };
  }

  if (scope === 'household') {
    return {
      scope_origin: 'household',
      rolls_up_from_personal: true,
      household_context_included: true,
      hierarchy_level: 'household_rollup',
    };
  }

  return {
    scope_origin: 'personal',
    rolls_up_from_personal: false,
    household_context_included: false,
    hierarchy_level: 'personal',
  };
}

function annotateInsightScopeLineage(insight) {
  if (!insight) return insight;
  return {
    ...insight,
    metadata: {
      ...(insight.metadata || {}),
      ...buildScopeLineageMetadata(insight.metadata || {}),
    },
  };
}

function consolidateScopedInsightGroup(group = []) {
  if (group.length < 2) return group[0] || null;

  const sorted = [...group].sort((a, b) => {
    const scopeRank = (insight) => (insight?.metadata?.scope === 'personal' ? 1 : 0);
    return scopeRank(b) - scopeRank(a)
      || maturityRankForInsight(b) - maturityRankForInsight(a)
      || severityRank(b.severity) - severityRank(a.severity)
      || insightDestinationAdjustment(b) - insightDestinationAdjustment(a)
      || new Date(b.created_at) - new Date(a.created_at);
  });
  const primary = sorted[0];
  const companions = sorted.slice(1);
  const companionScopes = companions.map((insight) => insight.metadata?.scope).filter(Boolean);
  const hasPersonal = [primary, ...companions].some((insight) => insight.metadata?.scope === 'personal');
  const hasHousehold = [primary, ...companions].some((insight) => insight.metadata?.scope === 'household');
  const entityName = primary.metadata?.category_name || primary.metadata?.merchant_name;

  let title = primary.title;
  let body = primary.body;
  if (hasPersonal && hasHousehold) {
    if (primary.entity_type === 'category' && entityName) {
      title = `${entityName} is showing up in your spending and rolling into the household`;
      body = `${primary.body} A similar household card pointed in the same direction, so this shared read starts with your pattern and shows how it carries into the household.`;
    } else if (primary.entity_type === 'merchant' && entityName) {
      title = `${entityName} is repeating in your spending and the household`;
      body = `${primary.body} A similar household merchant card was folded in so you can see how your pattern overlaps with the broader household picture.`;
    } else {
      title = primary.title;
      body = `${primary.body} A similar household card was folded into this one so you can start from your own spending and then see the shared impact.`;
    }
  }

  const consolidatedScopes = [];
  if (hasPersonal) consolidatedScopes.push('personal');
  if (hasHousehold) consolidatedScopes.push('household');
  const relatedInsightIds = companions.map((insight) => insight.id);

  return annotateInsightScopeLineage({
    ...primary,
    id: `${primary.id}:consolidated`,
    title,
    body,
    metadata: {
      ...primary.metadata,
      consolidated_scopes: consolidatedScopes,
      consolidated_from: [primary, ...companions].map((insight) => ({
        id: insight.id,
        type: insight.type,
        scope: insight.metadata?.scope || null,
        scope_origin: insight.metadata?.scope_origin || (insight.metadata?.scope === 'household' ? 'household' : 'personal'),
        rolls_up_from_personal: insight.metadata?.scope === 'household',
        maturity: insight.metadata?.maturity || null,
        severity: insight.severity || null,
      })),
      related_insight_ids: relatedInsightIds,
      scope_relationship: hasPersonal && hasHousehold ? 'personal_household_overlap' : 'same_scope_overlap',
    },
  });
}

function resolveScopeOverlapCompetition(insights = []) {
  const grouped = new Map();
  const passthrough = [];

  for (const insight of insights || []) {
    const key = scopeAgnosticContinuityKey(insight);
    if (!key || !isScopeConsolidatableInsight(insight)) {
      passthrough.push(insight);
      continue;
    }
    const group = grouped.get(key) || [];
    group.push(insight);
    grouped.set(key, group);
  }

  const resolved = [];
  for (const group of grouped.values()) {
    const scopes = new Set(group.map((insight) => insight.metadata?.scope).filter(Boolean));
    if (group.length < 2 || !scopes.has('personal') || !scopes.has('household')) {
      resolved.push(...group);
      continue;
    }
    resolved.push(consolidateScopedInsightGroup(group));
  }

  return [...passthrough, ...resolved].filter(Boolean).map(annotateInsightScopeLineage);
}

function resolveOpportunityCompetition(insights) {
  const byType = new Map(insights.map((insight) => [insight.id, insight]));
  const removals = new Set();

  const restockWindows = insights.filter((insight) => insight.type === 'recurring_restock_window');
  for (const restock of restockWindows) {
    const scope = restock.metadata?.scope;
    const month = restock.metadata?.month;
    if (!scope || !month) continue;

    for (const insight of insights) {
      if (insight.id === restock.id) continue;
      if (insight.metadata?.scope !== scope || insight.metadata?.month !== month) continue;

      if (insight.type === 'projected_month_end_under_budget') {
        removals.add(insight.id);
      }

      if (
        insight.type === 'projected_category_under_baseline'
        && insight.metadata?.category_key === restock.metadata?.category_key
      ) {
        removals.add(insight.id);
      }
    }
  }

  const categoryHeadroom = insights.filter((insight) => insight.type === 'projected_category_under_baseline');
  for (const categoryInsight of categoryHeadroom) {
    const scope = categoryInsight.metadata?.scope;
    const month = categoryInsight.metadata?.month;
    if (!scope || !month) continue;

    const generic = insights.find((insight) =>
      insight.type === 'projected_month_end_under_budget'
      && insight.metadata?.scope === scope
      && insight.metadata?.month === month
    );
    if (generic) {
      removals.add(generic.id);
    }
  }

  return insights.filter((insight) => !removals.has(insight.id) && byType.has(insight.id));
}

function resolveMaturityCompetition(insights) {
  const grouped = new Map();
  const passthrough = [];

  for (const insight of insights || []) {
    const key = insightContinuityKey(insight);
    const rank = maturityRankForInsight(insight);
    if (!key || rank <= 0) {
      passthrough.push(insight);
      continue;
    }

    const group = grouped.get(key) || [];
    group.push(insight);
    grouped.set(key, group);
  }

  const resolved = [];
  for (const group of grouped.values()) {
    const maxRank = group.reduce((max, insight) => Math.max(max, maturityRankForInsight(insight)), 0);
    const winners = group
      .filter((insight) => maturityRankForInsight(insight) === maxRank)
      .sort((a, b) =>
        severityRank(b.severity) - severityRank(a.severity)
        || insightDestinationAdjustment(b) - insightDestinationAdjustment(a)
        || new Date(b.created_at) - new Date(a.created_at)
      );

    resolved.push(winners[0]);
  }

  return [...passthrough, ...resolved];
}

function resolveInsightCompetition(insights) {
  return resolveScopeOverlapCompetition(resolveMaturityCompetition(resolveOpportunityCompetition(insights)));
}

module.exports = {
  severityRank,
  insightDestinationAdjustment,
  maturityRankForInsight,
  buildScopeLineageMetadata,
  annotateInsightScopeLineage,
  insightContinuityKey,
  scopeAgnosticContinuityKey,
  isScopeConsolidatableInsight,
  consolidateScopedInsightGroup,
  resolveScopeOverlapCompetition,
  resolveOpportunityCompetition,
  resolveMaturityCompetition,
  resolveInsightCompetition,
};
