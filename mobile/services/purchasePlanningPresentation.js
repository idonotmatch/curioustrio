function currency(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '$0';
  return number.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function strategyCopy(snapshot = {}) {
  const gap = Number(snapshot.funding_gap || 0);
  const monthly = Number(snapshot.recovery_monthly || 0);
  switch (snapshot.recommended_strategy) {
    case 'funded_now':
      return { title: 'You have ways to cover this', body: 'Current budget room and any money already earmarked can cover the working price.' };
    case 'use_savings':
      return { title: 'A funding source can close the gap', body: 'This fits when you combine current room with savings or another source you chose.' };
    case 'rebalance_and_recover':
      return { title: 'Buy now, then recover', body: `${currency(gap)} would run above currently funded room. Recover about ${currency(monthly)} per month.` };
    case 'wait_and_save':
      return { title: 'Give this more time', body: `${currency(gap)} is still unfunded. Setting that aside first would protect the rest of the budget.` };
    default:
      return { title: 'Building the funding view', body: 'Adlo is checking current room, saved funds, and recovery options.' };
  }
}

function planChangeCopy(snapshot = {}) {
  if (snapshot.material_change === 'improved') return 'Funding got easier';
  if (snapshot.material_change === 'worsened') return 'Funding got tighter';
  return '';
}

function priceStatusCopy(watch = {}, snapshot = {}) {
  const observed = Number(snapshot.observed_price || watch.last_observed_price || 0);
  const target = Number(watch.target_price || 0);
  const merchant = snapshot?.metadata?.price_merchant || null;
  const observedLabel = merchant ? `${currency(observed, 2)} at ${merchant}` : currency(observed, 2);
  if (!observed) return target ? `Watching for ${currency(target, 2)}` : 'Waiting for a price observation';
  if (target && observed <= target) return `${observedLabel} is at your target`;
  if (target) return `${observedLabel} · target ${currency(target, 2)}`;
  return `${observedLabel} · best observed`;
}

function fundingHistoryCopy(history = []) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const newest = history[0];
  const oldest = history[history.length - 1];
  const gapDelta = Number(newest.funding_gap || 0) - Number(oldest.funding_gap || 0);
  const roomDelta = Number(newest.current_headroom || 0) - Number(oldest.current_headroom || 0);
  const priceDelta = Number(newest.observed_price || newest.evaluated_amount || 0)
    - Number(oldest.observed_price || oldest.evaluated_amount || 0);
  if (Math.abs(priceDelta) >= 1) {
    return priceDelta < 0
      ? `The working price fell ${currency(Math.abs(priceDelta))} while you considered it.`
      : `The working price rose ${currency(priceDelta)} while you considered it.`;
  }
  if (Math.abs(gapDelta) >= 1) {
    return gapDelta < 0
      ? `${currency(Math.abs(gapDelta))} more of the purchase is now covered.`
      : `The unfunded gap grew by ${currency(gapDelta)}.`;
  }
  if (Math.abs(roomDelta) >= 1) {
    return roomDelta > 0
      ? `Current budget room improved by ${currency(roomDelta)}.`
      : `Current budget room tightened by ${currency(Math.abs(roomDelta))}.`;
  }
  return 'The funding picture has stayed broadly stable.';
}

module.exports = { currency, strategyCopy, planChangeCopy, priceStatusCopy, fundingHistoryCopy };
