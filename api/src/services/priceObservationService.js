const ProductPriceObservation = require('../models/productPriceObservation');
const { detectRecurringWatchCandidates } = require('./recurringDetector');

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isSameNormalizedUnit(candidate, observation) {
  const candidateUnit = candidate?.normalized_total_size_unit || null;
  const observationUnit = observation?.normalized_total_size_unit || null;
  if (!candidateUnit || !observationUnit) return false;
  return candidateUnit === observationUnit;
}

function hasComparableUnitPricing(candidate, observation) {
  return (
    candidate?.median_unit_price != null &&
    observation?.observed_unit_price != null &&
    isSameNormalizedUnit(candidate, observation)
  );
}

function chooseComparison(candidate, observation) {
  if (hasComparableUnitPricing(candidate, observation)) {
    return {
      comparison_type: 'unit_price',
      baseline_value: Number(candidate.median_unit_price),
      observed_value: Number(observation.observed_unit_price),
    };
  }

  if (candidate?.median_amount != null && observation?.observed_price != null) {
    return {
      comparison_type: 'price',
      baseline_value: Number(candidate.median_amount),
      observed_value: Number(observation.observed_price),
    };
  }

  return null;
}

function compareObservationToBaseline(candidate, observation) {
  const comparison = chooseComparison(candidate, observation);
  if (!comparison || comparison.baseline_value <= 0 || comparison.observed_value <= 0) return null;

  const deltaAmount = Number((comparison.baseline_value - comparison.observed_value).toFixed(4));
  const discountPercent = Number(((deltaAmount / comparison.baseline_value) * 100).toFixed(1));

  return {
    comparison_type: comparison.comparison_type,
    baseline_value: comparison.baseline_value,
    observed_value: comparison.observed_value,
    savings_amount: Number(deltaAmount.toFixed(2)),
    discount_percent: discountPercent,
  };
}

function isMeaningfulOpportunity(candidate, observation, comparison) {
  if (!comparison) return false;
  if (comparison.discount_percent < 5) return false;

  if (comparison.comparison_type === 'unit_price') {
    const candidateTotalSize = Number(candidate?.normalized_total_size_value || 0);
    const observationTotalSize = Number(observation?.normalized_total_size_value || 0);
    const comparableSize = !candidateTotalSize || !observationTotalSize || Math.abs(candidateTotalSize - observationTotalSize) <= 0.5;
    if (!comparableSize) return false;

    const estimatedSavings = candidateTotalSize
      ? Number(((comparison.baseline_value - comparison.observed_value) * candidateTotalSize).toFixed(2))
      : comparison.savings_amount;
    return estimatedSavings >= 1.5;
  }

  return comparison.savings_amount >= 1.5;
}

async function findBestObservationForCandidate(candidate, { freshnessHours = 72 } = {}) {
  const since = hoursAgo(freshnessHours);
  const rows = await ProductPriceObservation.findRecentByIdentity({
    productId: candidate.product_id || null,
    comparableKey: candidate.group_key?.startsWith('comparable:') ? candidate.group_key.slice('comparable:'.length) : null,
    since,
    limit: 25,
  });

  const comparisons = rows
    .map((observation) => {
      const comparison = compareObservationToBaseline(candidate, observation);
      if (!isMeaningfulOpportunity(candidate, observation, comparison)) return null;
      return {
        candidate,
        observation,
        ...comparison,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.discount_percent - a.discount_percent || b.savings_amount - a.savings_amount);

  return comparisons[0] || null;
}

async function findObservationOpportunities(householdId, { windowDays = 5, freshnessHours = 72 } = {}) {
  const candidates = await detectRecurringWatchCandidates(householdId, { windowDays });
  const activeCandidates = candidates.filter((candidate) =>
    candidate.status === 'watching' || candidate.status === 'due_today' || candidate.status === 'overdue'
  );

  const opportunities = [];
  for (const candidate of activeCandidates) {
    const best = await findBestObservationForCandidate(candidate, { freshnessHours });
    if (!best) continue;
    opportunities.push({
      kind: 'watch_opportunity',
      signal: 'buy_soon_better_price',
      group_key: candidate.group_key,
      product_id: candidate.product_id || null,
      item_name: candidate.item_name,
      brand: candidate.brand || null,
      merchant: best.observation.merchant,
      observed_price: best.observation.observed_price == null ? null : Number(best.observation.observed_price),
      observed_unit_price: best.observation.observed_unit_price == null ? null : Number(best.observation.observed_unit_price),
      baseline_price: best.comparison_type === 'price' ? best.baseline_value : Number(candidate.median_amount || 0),
      baseline_unit_price: best.comparison_type === 'unit_price' ? best.baseline_value : Number(candidate.median_unit_price || 0),
      comparison_type: best.comparison_type,
      savings_amount: best.savings_amount,
      discount_percent: best.discount_percent,
      url: best.observation.url || null,
      source_type: best.observation.source_type || null,
      observed_at: best.observation.observed_at,
      next_expected_date: candidate.next_expected_date,
      days_until_due: candidate.days_until_due,
      status: candidate.status,
      merchants: candidate.merchants,
      normalized_total_size_value: candidate.normalized_total_size_value,
      normalized_total_size_unit: candidate.normalized_total_size_unit,
    });
  }

  return opportunities.sort((a, b) => b.discount_percent - a.discount_percent || b.savings_amount - a.savings_amount);
}

module.exports = {
  compareObservationToBaseline,
  findBestObservationForCandidate,
  findObservationOpportunities,
};
