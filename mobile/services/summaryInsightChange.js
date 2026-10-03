function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = num(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function formatCurrency(value) {
  const amount = Math.round(Math.abs(Number(value || 0)));
  if (amount >= 1000) {
    const short = amount / 1000;
    return `$${short >= 10 ? short.toFixed(0) : short.toFixed(1)}k`;
  }
  return `$${amount}`;
}

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  if (amount === 0) return '$0';
  return `${amount > 0 ? '+' : '-'}${formatCurrency(amount)}`;
}

function insightKey(insight = {}) {
  const metadata = insight.metadata || {};
  return [
    insight.entity_type,
    insight.entity_id,
  ].filter(Boolean).join(':')
    || [
      insight.type,
      metadata.category_key,
      metadata.merchant_key || metadata.merchant_name,
      metadata.group_key,
    ].filter(Boolean).join(':')
    || insight.id
    || '';
}

function insightDelta(insight = {}) {
  const metadata = insight.metadata || {};
  return firstNumber(
    metadata.projected_budget_delta,
    metadata.projected_over_under,
    metadata.projected_headroom_amount != null ? -Math.abs(Number(metadata.projected_headroom_amount)) : null,
    metadata.delta_amount,
    metadata.projected_month_end,
    metadata.projected_spend,
    metadata.current_spend_to_date,
    metadata.current_spend
  );
}

function buildInsightPortfolio(insights = []) {
  if (!Array.isArray(insights)) return [];
  return insights.map((insight, index) => ({
    key: insightKey(insight),
    id: insight.id || null,
    title: insight.title || 'Recent activity changed',
    type: insight.type || null,
    rank: index,
    delta: insightDelta(insight),
  })).filter((item) => item.key);
}

function magnitude(item = {}) {
  return Math.abs(Number(item.delta || 0));
}

function isMaterial(item = {}) {
  return magnitude(item) >= 25;
}

function sortByMagnitude(a, b) {
  return magnitude(b) - magnitude(a);
}

function topMaterial(portfolio = []) {
  return [...portfolio].filter(isMaterial).sort(sortByMagnitude)[0] || null;
}

function response({ state, title, body, metric = null, tone = 'info' }) {
  return {
    state,
    tone,
    title,
    body,
    metric,
    cta: { label: 'Review cards', target: 'insights' },
    source: 'insights',
  };
}

function buildSummaryInsightMovement(current = [], previous = []) {
  if (!current.length) return null;
  const currentByKey = new Map(current.map((item) => [item.key, item]));
  const previousByKey = new Map(previous.map((item) => [item.key, item]));
  const currentTop = topMaterial(current);
  const previousTop = topMaterial(previous);

  if (!previous.length && currentTop) {
    return response({
      state: 'current_top_signal',
      tone: Number(currentTop.delta || 0) > 0 ? 'warning' : 'info',
      title: currentTop.title,
      body: `${formatSignedCurrency(currentTop.delta)} versus the usual pace for this period.`,
      metric: { label: 'Change', value: currentTop.delta, display: formatSignedCurrency(currentTop.delta) },
    });
  }

  const newItems = current.filter((item) => !previousByKey.has(item.key) && isMaterial(item));
  if (newItems.length) {
    const item = newItems.sort(sortByMagnitude)[0];
    return response({
      state: 'new_insight_detected',
      tone: Number(item.delta || 0) > 0 ? 'warning' : 'info',
      title: item.title,
      body: `${formatSignedCurrency(item.delta)} versus the usual pace for this period.`,
      metric: { label: 'Change', value: item.delta, display: formatSignedCurrency(item.delta) },
    });
  }

  const resolvedItems = previous.filter((item) => !currentByKey.has(item.key) && isMaterial(item));
  if (resolvedItems.length) {
    const item = resolvedItems.sort(sortByMagnitude)[0];
    return response({
      state: 'insight_resolved',
      tone: 'positive',
      title: `${item.title} fell out of focus`,
      body: 'That driver is no longer moving the month enough to stay at the top.',
    });
  }

  if (currentTop && previousTop && currentTop.key !== previousTop.key) {
    return response({
      state: 'top_driver_changed',
      title: currentTop.title,
      body: `${formatSignedCurrency(currentTop.delta)} versus the usual pace for this period.`,
      metric: { label: 'Change', value: currentTop.delta, display: formatSignedCurrency(currentTop.delta) },
    });
  }

  return null;
}

function shouldUseLocalInsightMovement(backendMovement = null) {
  const state = backendMovement?.state || '';
  return !backendMovement
    || state === 'quiet_stable'
    || state === 'first_run'
    || state === 'import_synced_no_material_change';
}

module.exports = {
  buildInsightPortfolio,
  buildSummaryInsightMovement,
  shouldUseLocalInsightMovement,
};
