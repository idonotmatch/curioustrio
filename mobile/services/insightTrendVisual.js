function numberValue(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function formatCurrencyShort(value) {
  const amount = numberValue(value);
  if (amount == null) return null;
  const prefix = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 1000) return `${prefix}$${(absolute / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${prefix}$${Math.round(absolute)}`;
}

function formatSignedCurrency(value) {
  const amount = numberValue(value);
  if (amount == null) return null;
  if (amount === 0) return '$0';
  const sign = amount > 0 ? '+' : '-';
  return `${sign}${formatCurrencyShort(Math.abs(amount))}`;
}

function formatPercent(value) {
  const percent = numberValue(value);
  if (percent == null) return null;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${Math.round(percent)}%`;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function daysInMonth(month) {
  const [year, mon] = `${month || ''}`.split('-').map(Number);
  if (!year || !mon) return null;
  return new Date(year, mon, 0).getDate();
}

function makeSparkPoints({ current, previous, delta, largest }) {
  const currentValue = numberValue(current);
  const previousValue = numberValue(previous);
  const deltaValue = numberValue(delta);
  const largestValue = numberValue(largest);

  if (previousValue != null && currentValue != null) {
    const midpoint = previousValue + ((currentValue - previousValue) * 0.45);
    const spike = largestValue != null && largestValue > Math.max(previousValue, currentValue)
      ? largestValue
      : midpoint;
    return [previousValue, midpoint, spike, currentValue].map((value) => Math.max(0, value));
  }

  if (deltaValue != null) {
    const baseline = Math.max(Math.abs(deltaValue) * 0.75, 1);
    return deltaValue >= 0
      ? [baseline, baseline * 1.08, baseline + Math.abs(deltaValue)]
      : [baseline + Math.abs(deltaValue), baseline * 1.08, baseline];
  }

  return null;
}

function normalizePoints(values = []) {
  if (!Array.isArray(values)) return null;
  const cleanValues = values.map(numberValue).filter((value) => value != null);
  if (cleanValues.length < 2) return null;
  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);
  const spread = max - min || 1;
  return cleanValues.map((value) => clamp((value - min) / spread));
}

function projectionFromForecast(forecast = null) {
  if (!forecast?.projected_value && !forecast?.projected_delta) return null;
  const projectedDelta = numberValue(forecast.projected_delta);
  const projectedValue = numberValue(forecast.projected_value);
  const tone = projectedDelta > 0 ? 'warning' : projectedDelta < 0 ? 'info' : 'neutral';
  const value = projectedDelta != null
    ? projectedDelta > 0
      ? `${formatSignedCurrency(projectedDelta)} projected`
      : `${formatCurrencyShort(Math.abs(projectedDelta))} room`
    : `Around ${formatCurrencyShort(projectedValue)}`;
  return {
    label: forecast.forecast_type === 'recurrence_timing' ? 'Next expected' : 'If pace holds',
    value,
    tone,
    projectedValue,
    projectedDelta,
    confidenceLabel: forecast.confidence_label || null,
  };
}

function projectionFromMetadata(metadata = {}, variant = '', type = '') {
  const projectedDelta = firstNumber(metadata.projected_budget_delta, metadata.projected_over_under);
  const observedDelta = firstNumber(metadata.delta_amount, metadata.one_off_delta_amount, metadata.total_delta_amount);
  const headroom = firstNumber(metadata.projected_headroom_amount);
  const projectedValue = firstNumber(
    metadata.adjusted_projected_total,
    metadata.projected_month_end,
    metadata.projected_spend,
    metadata.projected_total
  );
  const current = firstNumber(metadata.current_spend_to_date, metadata.current_spend);
  const activeDays = firstNumber(metadata.active_day_count);
  const totalDays = daysInMonth(metadata.month) || (variant === 'spark' ? 30 : null);
  const runRateProjection = current != null && activeDays > 0 && totalDays
    ? current * (totalDays / activeDays)
    : null;
  const observedWindowDays = activeDays || (variant === 'spark' ? 7 : null);
  const deltaRunRateProjection = observedDelta != null
    && observedWindowDays
    && totalDays
    && !`${type}`.includes('one_off')
    ? observedDelta * (totalDays / observedWindowDays)
    : null;

  if (headroom != null) {
    return {
      label: 'If pace holds',
      value: `${formatCurrencyShort(Math.abs(headroom))} room`,
      tone: 'info',
      projectedValue,
      projectedDelta: -Math.abs(headroom),
      confidenceLabel: metadata.confidence || null,
    };
  }

  if (projectedDelta != null) {
    return {
      label: 'If pace holds',
      value: variant === 'spark'
        ? `${formatSignedCurrency(projectedDelta)} vs usual`
        : `${formatSignedCurrency(projectedDelta)} projected`,
      tone: projectedDelta > 0 ? 'warning' : projectedDelta < 0 ? 'info' : 'neutral',
      projectedValue,
      projectedDelta,
      confidenceLabel: metadata.confidence || null,
    };
  }

  if (deltaRunRateProjection != null) {
    return {
      label: 'If pace holds',
      value: `${formatSignedCurrency(deltaRunRateProjection)} vs usual`,
      tone: deltaRunRateProjection > 0 ? 'warning' : deltaRunRateProjection < 0 ? 'info' : 'neutral',
      projectedValue,
      projectedDelta: deltaRunRateProjection,
      confidenceLabel: metadata.confidence || null,
    };
  }

  if (projectedValue != null || runRateProjection != null) {
    const value = projectedValue ?? runRateProjection;
    return {
      label: 'If pace holds',
      value: `Around ${formatCurrencyShort(value)}`,
      tone: 'neutral',
      projectedValue: value,
      projectedDelta: null,
      confidenceLabel: metadata.confidence || null,
    };
  }

  return null;
}

function applyForecastProjection(visual, forecast, metadata = {}) {
  if (!visual) return visual;
  const projection = projectionFromForecast(forecast) || projectionFromMetadata(metadata, visual.variant, visual.insightType);
  if (!projection) return visual;
  return {
    ...visual,
    insightType: undefined,
    projection,
    tone: visual.tone === 'neutral' ? projection.tone : visual.tone,
  };
}

function buildPaceVisual(type, metadata = {}, forecast = null) {
  const built = buildPaceVisualBase(type, metadata);
  return applyForecastProjection(built, forecast, metadata);
}

function buildPaceVisualBase(type, metadata = {}) {
  const usedPercent = firstNumber(metadata.budget_used_percent, metadata.percent_used);
  const delta = firstNumber(metadata.projected_budget_delta, metadata.projected_over_under);
  const headroom = firstNumber(metadata.projected_headroom_amount);
  const deltaPercent = firstNumber(metadata.delta_percent);
  const current = firstNumber(metadata.current_spend_to_date, metadata.current_spend);
  const usual = firstNumber(metadata.previous_spend, metadata.average_actual_spend_last_6);

  let progress = usedPercent != null ? usedPercent / 100 : null;
  if (progress == null && current != null && usual != null && usual > 0) {
    progress = current / usual;
  }
  if (progress == null && headroom != null && current != null) {
    progress = current / Math.max(current + headroom, 1);
  }
  if (progress == null && deltaPercent != null) {
    progress = 0.5 + (deltaPercent / 200);
  }
  if (progress == null && delta != null) {
    progress = 0.5 + (delta / Math.max(Math.abs(delta) * 2, 1));
  }
  if (progress == null) return null;

  const isOver = progress > 1 || delta > 0 || type === 'projected_month_end_over_budget' || type === 'budget_too_low';
  const hasRoom = headroom > 0 || delta < 0 || type === 'projected_month_end_under_budget';
  const value = usedPercent != null
    ? `${Math.round(usedPercent)}% used`
    : headroom != null && hasRoom
      ? `${formatCurrencyShort(headroom)} room`
      : formatSignedCurrency(delta) || formatPercent(deltaPercent);

  return {
    variant: 'pace',
    insightType: type,
    label: hasRoom ? 'Room vs baseline' : 'Pace vs baseline',
    value,
    tone: isOver ? 'danger' : hasRoom ? 'info' : 'neutral',
    progress: clamp(progress, 0, 1.2),
    marker: usual != null || usedPercent != null ? 1 : null,
  };
}

function buildSparkVisual(type, metadata = {}, forecast = null) {
  const deltaAmount = firstNumber(
    metadata.delta_amount,
    metadata.one_off_delta_amount,
    metadata.total_delta_amount,
    metadata.projected_headroom_amount,
    metadata.projected_budget_delta
  );
  const deltaPercent = firstNumber(metadata.delta_percent);
  const current = firstNumber(metadata.current_spend_to_date, metadata.current_spend);
  const previous = firstNumber(metadata.previous_spend, metadata.average_actual_spend_last_6);
  const largest = firstNumber(metadata.largest_expense?.amount);
  const points = normalizePoints(makeSparkPoints({ current, previous, delta: deltaAmount, largest }));

  if (!points) return null;

  const value = deltaPercent != null ? formatPercent(deltaPercent) : formatSignedCurrency(deltaAmount);
  let label = 'Vs usual';
  if (type === 'developing_weekly_spend_change') label = 'Week over week';
  else if (type.includes('one_off')) label = 'One-off impact';
  else if (type === 'recurring_cost_pressure') label = 'Recurring pressure';

  return applyForecastProjection({
    variant: 'spark',
    insightType: type,
    label,
    value,
    tone: type.includes('under_baseline') ? 'info' : deltaAmount > 0 || deltaPercent > 0 ? 'warning' : 'neutral',
    points,
  }, forecast, metadata);
}

function buildRhythmVisual(type, metadata = {}, forecast = null) {
  const purchases = Array.isArray(metadata.purchases) ? metadata.purchases : [];
  const count = firstNumber(metadata.occurrence_count, metadata.merchant_count, purchases.length);
  const averageGap = firstNumber(metadata.average_gap_days);
  const latestGap = firstNumber(metadata.latest_gap_days);
  const daysUntilDue = firstNumber(metadata.days_until_due);
  if (count == null && averageGap == null && daysUntilDue == null) return null;

  let value = count != null ? `${Math.round(count)}x` : null;
  if (daysUntilDue != null) value = daysUntilDue <= 0 ? 'Due now' : `${Math.round(daysUntilDue)}d`;
  else if (latestGap != null && averageGap != null) value = `${Math.round(latestGap)}d gap`;
  else if (averageGap != null) value = `Every ${Math.round(averageGap)}d`;

  return applyForecastProjection({
    variant: 'rhythm',
    insightType: type,
    label: daysUntilDue != null ? 'Timing signal' : 'Repeat rhythm',
    value,
    tone: daysUntilDue != null && daysUntilDue <= 3 ? 'warning' : 'neutral',
    count: clamp(Math.round(count || purchases.length || 3), 2, 6),
    activeIndex: daysUntilDue != null && daysUntilDue <= 0 ? 5 : null,
  }, forecast, metadata);
}

function getInsightTrendVisual(insight = {}) {
  const type = `${insight?.type || ''}`;
  const metadata = insight?.metadata || {};
  const forecast = insight?.forecast || null;

  if (
    type === 'early_budget_pace'
    || type === 'spend_pace_ahead'
    || type === 'spend_pace_behind'
    || type === 'budget_too_low'
    || type === 'budget_too_high'
    || type === 'projected_month_end_over_budget'
    || type === 'projected_month_end_under_budget'
    || (type === 'usage_ready_to_plan' && metadata.projected_headroom_amount != null)
  ) {
    return buildPaceVisual(type, metadata, forecast);
  }

  if (
    type === 'developing_weekly_spend_change'
    || type === 'developing_category_shift'
    || type === 'early_top_category'
    || type === 'top_category_driver'
    || type === 'projected_category_surge'
    || type === 'projected_category_under_baseline'
    || type === 'one_off_expense_skewing_projection'
    || type === 'one_offs_driving_variance'
    || type === 'recurring_cost_pressure'
  ) {
    return buildSparkVisual(type, metadata, forecast);
  }

  if (
    type === 'early_repeated_merchant'
    || type === 'developing_repeated_merchant'
    || type === 'item_repurchase_accelerating'
    || type === 'item_staple_emerging'
    || type === 'recurring_repurchase_due'
    || type === 'recurring_restock_window'
    || type === 'buy_soon_better_price'
    || type === 'item_staple_merchant_opportunity'
    || type === 'item_merchant_variance'
    || type === 'item_recent_price_jump'
    || type === 'recurring_price_spike'
  ) {
    return buildRhythmVisual(type, metadata, forecast);
  }

  return null;
}

module.exports = {
  getInsightTrendVisual,
  normalizePoints,
};
