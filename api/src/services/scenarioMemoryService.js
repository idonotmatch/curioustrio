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
  refreshConsideringScenarios,
};
