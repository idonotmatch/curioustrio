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
