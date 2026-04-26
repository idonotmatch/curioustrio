export function formatCurrencyRounded(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `$${Math.max(0, Math.round(Math.abs(amount)))}`;
}

function niceStep(value) {
  if (value >= 250) return 50;
  if (value >= 120) return 25;
  if (value >= 60) return 10;
  return 5;
}

function roundDownNice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const step = niceStep(amount);
  return Math.max(step, Math.floor(amount / step) * step);
}

export function planningSnapshot(metadata = {}) {
  const headroom = Number(metadata.projected_headroom_amount || 0);
  const budgetDelta = metadata.projected_budget_delta == null ? null : Number(metadata.projected_budget_delta || 0);
  const daysRemaining = Number(metadata.days_remaining);
  const historicalCount = Number(metadata.historical_period_count || 0);
  const confidence = `${metadata.planning_confidence || (historicalCount >= 3 ? 'baseline' : 'directional')}`;

  let roomStatus = 'tight';
  if (budgetDelta != null && budgetDelta > 0) roomStatus = 'over_budget';
  else if (headroom >= 120) roomStatus = 'roomy';
  else if (headroom >= 50) roomStatus = 'moderate';

  return {
    headroom,
    budgetDelta,
    daysRemaining: Number.isFinite(daysRemaining) ? daysRemaining : null,
    historicalCount,
    confidence,
    roomStatus,
  };
}

export function planningActionSummary(metadata = {}) {
  const snapshot = planningSnapshot(metadata);

  if (snapshot.roomStatus === 'over_budget') {
    return {
      title: 'Start with a smaller what-if',
      body: 'Your month already looks pressured, so begin with a smaller purchase or compare a later timing before treating this as available room.',
    };
  }

  if (snapshot.confidence === 'directional') {
    return {
      title: 'Use this as a directional planning pass',
      body: snapshot.headroom > 0
        ? `There looks like roughly ${formatCurrencyRounded(snapshot.headroom)} of room right now, but treat that as a starting point while the baseline is still maturing.`
        : 'Use this to pressure-test smaller purchases first while the baseline is still maturing.',
    };
  }

  if (snapshot.headroom >= 120) {
    return {
      title: 'Turn this room into a real plan',
      body: `There looks like about ${formatCurrencyRounded(snapshot.headroom)} of room to work with, which is enough to compare a few purchase sizes or timing options now.`,
    };
  }

  return {
    title: 'Pressure-test the purchase before you commit',
    body: snapshot.headroom > 0
      ? `There is some room available, around ${formatCurrencyRounded(snapshot.headroom)}, but comparing timing should help avoid crowding the rest of the month.`
      : 'The room looks limited, so compare timing before assuming the month can absorb it cleanly.',
  };
}

export function planningSuggestionAmounts(metadata = {}) {
  const snapshot = planningSnapshot(metadata);
  const ceiling = snapshot.headroom > 0 ? roundDownNice(snapshot.headroom) : 0;
  if (ceiling <= 0) return [];

  const values = new Set();
  values.add(Math.max(5, roundDownNice(ceiling * 0.25)));
  values.add(Math.max(10, roundDownNice(ceiling * 0.5)));
  values.add(ceiling);

  return [...values]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
    .map((value) => ({
      amount: value,
      label: formatCurrencyRounded(value),
    }));
}

export function planningFeedbackSummary(summary = {}, timingPreferences = {}, recommendation = null) {
  const totalChoices = Number(summary?.total_choices || 0);
  const followRate = summary?.follow_rate == null ? null : Number(summary.follow_rate || 0);
  const recommendedMode = `${recommendation?.timing_mode || ''}`.trim();
  const modeStats = recommendedMode ? timingPreferences?.[recommendedMode] : null;

  if (modeStats && Number(modeStats.total || 0) >= 3 && Number(modeStats.follow_rate || 0) >= 0.7) {
    const label = recommendedMode === 'next_period'
      ? 'wait when it clearly opens more room'
      : recommendedMode === 'spread_3_periods'
        ? 'spread purchases out when the month is close'
        : 'keep purchases in the current period when they fit cleanly';
    return {
      title: 'Your planning pattern',
      body: `You usually ${label}, so this recommendation is leaning into that pattern.`,
    };
  }

  if (totalChoices >= 3 && followRate != null) {
    if (followRate >= 0.7) {
      return {
        title: 'Your planning pattern',
        body: 'You usually follow the recommendation when you compare options, so Adlo is using that history here.',
      };
    }
    if (followRate <= 0.35) {
      return {
        title: 'Your planning pattern',
        body: 'You often choose a different path than the default recommendation, so treat this as a starting point rather than a rule.',
      };
    }
  }

  return null;
}

export function timingModeSummary(mode) {
  switch (`${mode || ''}`.trim()) {
    case 'next_period':
      return 'wait until next period';
    case 'spread_3_periods':
      return 'spread it across 3 periods';
    default:
      return 'do it in the current period';
  }
}

export function recentPlanDecisionSummary(plan = {}) {
  const followed = plan?.last_choice_followed_recommendation;
  const recommendedMode = `${plan?.last_recommended_timing_mode || ''}`.trim();
  const choiceSource = `${plan?.last_choice_source || ''}`.trim();
  if (followed == null || !recommendedMode) return null;

  const recommendationCopy = timingModeSummary(recommendedMode);
  const sourceCopy = choiceSource === 'compare_option'
    ? 'after comparing options'
    : choiceSource === 'recent_plan'
      ? 'when you re-checked it'
      : 'on the first pass';

  if (followed) {
    return `You followed the recommendation to ${recommendationCopy} ${sourceCopy}.`;
  }
  return `You chose a different path than the recommendation to ${recommendationCopy} ${sourceCopy}.`;
}

export function recentPlanResolutionSummary(plan = {}) {
  const action = `${plan?.resolution_action || ''}`.trim();
  if (!action) return null;
  if (action === 'bought') return 'You went ahead with it.';
  if (action === 'not_buying') return 'You decided not to buy it.';
  if (action === 'revisit_next_month') return 'You deferred this to next month.';
  return null;
}
