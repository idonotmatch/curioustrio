function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(`${value || ''}`);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) return null;
  return date;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, date.getUTCDate()));
}

function currentBudgetPeriod(todayValue, startDay = 1) {
  const today = parseDateOnly(todayValue) || parseDateOnly(new Date().toISOString().slice(0, 10));
  const safeStartDay = Math.max(1, Math.min(28, Number(startDay) || 1));
  const anchorOffset = today.getUTCDate() < safeStartDay ? -1 : 0;
  const from = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth() + anchorOffset,
    safeStartDay
  ));
  const to = addMonths(from, 1);
  return { today, from, to };
}

function formatPeriodLabel(from, to) {
  if (from.getUTCDate() === 1) {
    return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(from);
  }
  const end = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const format = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fromLabel = format.format(from);
  const toLabel = format.format(end);
  return `${fromLabel} - ${toLabel}`;
}

function paceState({ budgetLimit, spendingRatio, elapsedRatio }) {
  if (!(budgetLimit > 0)) {
    return { key: 'setup', label: 'Set a budget' };
  }
  if (spendingRatio >= 1 && elapsedRatio < 1) {
    return { key: 'reached', label: 'Budget reached' };
  }
  if (elapsedRatio >= 1) {
    return spendingRatio <= 1
      ? { key: 'within', label: 'Within budget' }
      : { key: 'over', label: 'Over budget' };
  }

  const paceDelta = spendingRatio - elapsedRatio;
  if (paceDelta > 0.12) return { key: 'high', label: 'Running high' };
  if (paceDelta > 0.04) return { key: 'elevated', label: 'A little high' };
  if (paceDelta < -0.1) return { key: 'below', label: 'Below pace' };
  return { key: 'on_pace', label: 'On pace' };
}

function buildWidgetSnapshot({
  budgetLimit,
  spent,
  pendingCount,
  startDay,
  today,
  generatedAt = new Date().toISOString(),
}) {
  const period = currentBudgetPeriod(today, startDay);
  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.round((period.to - period.from) / dayMs));
  const elapsedDays = Math.max(0, Math.floor((period.today - period.from) / dayMs) + 1);
  const elapsedRatio = clamp(elapsedDays / totalDays);
  const numericLimit = Math.max(0, Number(budgetLimit) || 0);
  const numericSpent = Math.max(0, Number(spent) || 0);
  const rawSpendingRatio = numericLimit > 0 ? numericSpent / numericLimit : 0;
  const state = paceState({
    budgetLimit: numericLimit,
    spendingRatio: rawSpendingRatio,
    elapsedRatio,
  });

  return {
    schema_version: 1,
    period: {
      from: toDateOnly(period.from),
      to: toDateOnly(period.to),
      label: formatPeriodLabel(period.from, period.to),
    },
    pace: {
      state: state.key,
      label: state.label,
      spending_ratio: clamp(rawSpendingRatio),
      period_elapsed_ratio: elapsedRatio,
    },
    pending_review_count: Math.max(0, Number(pendingCount) || 0),
    generated_at: generatedAt,
  };
}

module.exports = {
  buildWidgetSnapshot,
  currentBudgetPeriod,
  formatPeriodLabel,
  paceState,
};
