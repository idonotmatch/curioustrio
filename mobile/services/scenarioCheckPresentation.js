export function formatScenarioCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${Math.abs(amount).toFixed(0)}`;
}

export function formatAmountInput(value) {
  return value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

export function statusConfig(status) {
  switch (status) {
    case 'comfortable':
      return {
        label: 'Comfortable',
        headline: 'Yes, this looks comfortably absorbable.',
        tone: '#166534',
        chipBg: '#e6f7ed',
      };
    case 'absorbable':
      return {
        label: 'Absorbable',
        headline: 'Yes, but this uses a meaningful share of your remaining room.',
        tone: '#1d4ed8',
        chipBg: '#e8f0ff',
      };
    case 'tight':
      return {
        label: 'Tight',
        headline: 'Maybe, but the rest of the month would get tight.',
        tone: '#b45309',
        chipBg: '#fff4e5',
      };
    case 'risky':
      return {
        label: 'Risky',
        headline: 'This would likely push the month into a riskier range.',
        tone: '#b91c1c',
        chipBg: '#ffe8e8',
      };
    case 'not_absorbable':
      return {
        label: 'Not absorbable',
        headline: 'This does not look absorbable in the current month.',
        tone: '#991b1b',
        chipBg: '#ffe0e0',
      };
    default:
      return {
        label: 'Unknown',
        headline: 'There is not enough history yet to answer this confidently.',
        tone: '#475569',
        chipBg: '#e5e7eb',
      };
  }
}

export function reasonCopy(result) {
  const scenario = result?.scenario || {};
  const label = scenario.label || 'purchase';
  switch (scenario.reason) {
    case 'projected_headroom_remains':
      return `${label} still leaves room after expected recurring spend later in the period.`;
    case 'limited_but_positive_headroom':
      return `${label} still fits, but it would use a noticeable share of your remaining room.`;
    case 'limited_headroom_after_recurring_pressure':
      return `${label} technically fits, but upcoming recurring purchases make the rest of the period tighter.`;
    case 'headroom_consumed':
      return `${label} would likely consume the remaining headroom and push the period into a higher-risk range.`;
    case 'projected_over_budget_after_purchase':
      return `${label} would push the current projection above budget by period end.`;
    case 'insufficient_history':
      return 'Adlo does not have enough historical periods yet to answer this with confidence.';
    default:
      if (scenario.timing_mode === 'next_period') {
        return `This is based on how ${label} fits in the next budget period instead of landing all at once right now.`;
      }
      if (scenario.timing_mode === 'spread_3_periods') {
        return `This assumes ${label} is spread across three budget periods instead of hitting this one all at once.`;
      }
      return 'This is based on your current projection, recent period shape, and expected recurring pressure.';
  }
}

export function confidenceCopy(confidence) {
  if (confidence === 'very_low') return 'Very low confidence from limited spending history so far.';
  if (confidence === 'high') return 'High confidence from a stable spending pattern.';
  if (confidence === 'medium') return 'Moderate confidence based on your recent spending history.';
  if (confidence === 'low') return 'Lower confidence because this period is still early or more variable than usual.';
  return 'Confidence is still building as Adlo learns your period shape.';
}

export function scopeLabel(scope) {
  return scope === 'household' ? 'Household' : 'You';
}

export function timingModeLabel(mode) {
  switch (mode) {
    case 'next_period': return 'Next period';
    case 'spread_3_periods': return 'Spread over 3 periods';
    default: return 'This period';
  }
}

export function scopeContextCopy(scope, isMultiMember) {
  if (scope === 'household') {
    return 'Using shared household room, recurring pressure, and budget context.';
  }
  if (isMultiMember) {
    return 'Using only your personal room, not the shared household outlook.';
  }
  return 'Using your current personal spending outlook.';
}

export function recommendationButtonLabel(mode) {
  switch (mode) {
    case 'next_period': return 'Try next period';
    case 'spread_3_periods': return 'Try 3-period spread';
    default: return 'Try this period';
  }
}

export function optionMetricCopy(option) {
  const room = Number(option?.risk_adjusted_headroom_amount || 0);
  if (!Number.isFinite(room)) return 'Room still building';
  if (room > 0) return `${formatScenarioCurrency(room)} left`;
  return 'No room left';
}

export function optionTradeoffCopy(option) {
  const delta = Number(option?.tradeoff?.risk_adjusted_headroom_delta || 0);
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) return 'About the same room';
  if (delta > 0) return `${formatScenarioCurrency(delta)} more room than current`;
  return `${formatScenarioCurrency(Math.abs(delta))} less room than current`;
}

export function projectionDeltaCopy(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Projection still building';
  const amount = Number(value);
  if (amount > 0) return `${formatScenarioCurrency(amount)} over budget`;
  if (amount < 0) return `${formatScenarioCurrency(amount)} under budget`;
  return 'Right on budget';
}

export function recentPlanMetaCopy(plan) {
  const stateLabel = plan?.watch_enabled
    ? 'Watching'
    : plan?.memory_state === 'considering'
      ? 'Still considering'
      : 'Recent check';
  return `${scopeLabel(plan.scope)} · ${stateLabel}`;
}

export function recentPlanChangeCopy(plan) {
  if (plan?.memory_state !== 'considering') return '';
  if (plan?.last_material_change === 'improved') return 'Looks easier now';
  if (plan?.last_material_change === 'worsened') return 'Tighter than before';
  return '';
}

export function recentPlanStatusCopy(plan) {
  if (!plan?.last_affordability_status) return '';
  return statusConfig(plan.last_affordability_status).label;
}

export function recentPlanWhyChangedCopy(plan) {
  if (plan?.memory_state !== 'considering') return '';
  const previous = Number(plan?.previous_risk_adjusted_headroom_amount);
  const current = Number(plan?.last_risk_adjusted_headroom_amount);
  const hasBoth = Number.isFinite(previous) && Number.isFinite(current);
  const delta = hasBoth ? current - previous : 0;

  if (plan?.last_material_change === 'improved') {
    if (hasBoth && delta >= 25) return `${formatScenarioCurrency(delta)} more room opened up.`;
    return 'Your projected room improved since the last check.';
  }

  if (plan?.last_material_change === 'worsened') {
    if (hasBoth && delta <= -25) return `${formatScenarioCurrency(Math.abs(delta))} less room is left now.`;
    return 'Your projected room tightened since the last check.';
  }

  return '';
}
