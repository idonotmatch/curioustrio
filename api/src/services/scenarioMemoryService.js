const ScenarioMemory = require('../models/scenarioMemory');
const { evaluateScenarioAffordability } = require('./spendProjectionAnalyzer');

const STATUS_SCORE = {
  unknown: 0,
  not_absorbable: 1,
  risky: 2,
  tight: 3,
  absorbable: 4,
  comfortable: 5,
};

function detectMaterialChange(memory, scenario) {
  const previousStatus = `${memory?.last_affordability_status || ''}`;
  const nextStatus = `${scenario?.status || ''}`;
  const previousScore = STATUS_SCORE[previousStatus] || 0;
  const nextScore = STATUS_SCORE[nextStatus] || 0;
  const previousRiskAdjusted = Number(memory?.last_risk_adjusted_headroom_amount || 0);
  const nextRiskAdjusted = Number(scenario?.risk_adjusted_headroom_amount || 0);
  const delta = nextRiskAdjusted - previousRiskAdjusted;

  if (nextScore >= previousScore + 1 || delta >= 40) return 'improved';
  if (nextScore <= previousScore - 1 || delta <= -40) return 'worsened';
  return 'unchanged';
}

function timingPreferenceNoteForMode(mode, timingPreferences = {}) {
  const stats = timingPreferences?.[mode];
  if (!stats) return null;
  const total = Number(stats.total || 0);
  const compareOptionCount = Number(stats.compare_option_count || 0);
  const followRate = Number(stats.follow_rate || 0);
  const netSignal = Number(stats.net_signal || 0);
  if (total < 3 || compareOptionCount < 2 || followRate < 0.75 || netSignal < 2) return null;

  switch (mode) {
    case 'next_period':
      return 'You usually revisit these in the next period when room opens up.';
    case 'spread_3_periods':
      return 'You usually prefer spacing these out when the month is close.';
    default:
      return 'You usually keep these in the current period when they still fit cleanly.';
  }
}

async function decoratePlansWithTimingPreference(userId, items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const timingPreferences = await ScenarioMemory.summarizeTimingPreferences(userId).catch(() => ({}));
  return items.map((item) => ({
    ...item,
    timing_preference_note: timingPreferenceNoteForMode(item?.timing_mode || 'now', timingPreferences),
  }));
}

async function refreshConsideringScenarios(user, { limit = 5 } = {}) {
  const items = await ScenarioMemory.listActiveConsideringByUser(user.id, { limit });
  const refreshed = [];

  for (const item of items) {
    const result = await evaluateScenarioAffordability({
      user,
      scope: item.scope,
      month: item.month,
      proposedAmount: item.amount,
      label: item.label,
    });
    const materialChange = detectMaterialChange(item, result.scenario);
    const updated = await ScenarioMemory.updateEvaluation(item.id, user.id, result.scenario, materialChange);
    if (updated) refreshed.push(updated);
  }

  return refreshed;
}

module.exports = {
  detectMaterialChange,
  timingPreferenceNoteForMode,
  decoratePlansWithTimingPreference,
  refreshConsideringScenarios,
};
