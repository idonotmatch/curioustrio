const INITIAL_WIDGET_PROPS = Object.freeze({
  periodLabel: 'This month',
  paceLabel: 'Open Adlo',
  paceTone: 'neutral',
  spendingRatio: 0,
  hasFamilyBudget: false,
  familyPaceLabel: 'Open Adlo',
  familyPaceTone: 'neutral',
  familySpendingRatio: 0,
  elapsedRatio: 0,
  reviewLabel: 'No expenses to review',
  signedIn: false,
});

function clampRatio(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function paceTone(state) {
  if (state === 'high' || state === 'reached' || state === 'over') return 'attention';
  if (state === 'below' || state === 'within') return 'positive';
  if (state === 'elevated') return 'caution';
  return 'neutral';
}

function reviewLabel(countValue) {
  const count = Math.max(0, Number(countValue) || 0);
  if (count === 0) return 'No expenses to review';
  if (count === 1) return '1 expense to review';
  return `${count} expenses to review`;
}

function widgetPropsFromSnapshot(snapshot = null) {
  if (!snapshot || snapshot.schema_version !== 1) return { ...INITIAL_WIDGET_PROPS };
  return {
    periodLabel: snapshot.period?.label || 'This month',
    paceLabel: snapshot.pace?.label || 'Open Adlo',
    paceTone: paceTone(snapshot.pace?.state),
    spendingRatio: clampRatio(snapshot.pace?.spending_ratio),
    hasFamilyBudget: Boolean(snapshot.family_pace),
    familyPaceLabel: snapshot.family_pace?.label || 'Open Adlo',
    familyPaceTone: paceTone(snapshot.family_pace?.state),
    familySpendingRatio: clampRatio(snapshot.family_pace?.spending_ratio),
    elapsedRatio: clampRatio(snapshot.pace?.period_elapsed_ratio),
    reviewLabel: reviewLabel(snapshot.pending_review_count),
    signedIn: true,
  };
}

module.exports = {
  INITIAL_WIDGET_PROPS,
  clampRatio,
  paceTone,
  reviewLabel,
  widgetPropsFromSnapshot,
};
