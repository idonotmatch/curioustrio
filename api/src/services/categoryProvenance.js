function numericAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function categoryProvenanceWeight(expense = {}) {
  const source = `${expense?.category_source || ''}`.trim();
  const confidence = Number(expense?.category_confidence ?? 0);

  if (source === 'decision_memory') return 1;
  if (source === 'memory') {
    if (confidence >= 4) return 0.98;
    if (confidence >= 3) return 0.88;
    if (confidence >= 2) return 0.74;
    return 0.6;
  }
  if (source === 'description_memory') return 0.82;
  if (source === 'heuristic') return 0.76;
  if (source === 'manual_edit') return 0.88;
  if (source === 'claude') {
    if (confidence >= 4) return 0.78;
    if (confidence >= 3) return 0.68;
    if (confidence >= 2) return 0.56;
    if (confidence >= 1) return 0.46;
    return 0.35;
  }
  if (!source && confidence >= 3) return 0.6;
  if (!source && expense?.category_id) return 0.5;
  return 0.3;
}

function isTrustedCategoryAssignment(expense = {}) {
  return categoryProvenanceWeight(expense) >= 0.75;
}

function isLowConfidenceCategoryAssignment(expense = {}) {
  return categoryProvenanceWeight(expense) < 0.6;
}

function summarizeCategoryProvenance(expenses = []) {
  const rows = Array.isArray(expenses) ? expenses : [];
  let weightedAmount = 0;
  let absoluteAmount = 0;
  let trustedSpend = 0;
  let trustedCount = 0;
  let lowConfidenceCount = 0;

  for (const expense of rows) {
    const amount = Math.abs(numericAmount(expense?.amount));
    const weight = categoryProvenanceWeight(expense);
    absoluteAmount += amount;
    weightedAmount += amount * weight;
    if (isTrustedCategoryAssignment(expense)) {
      trustedSpend += amount;
      trustedCount += 1;
    }
    if (isLowConfidenceCategoryAssignment(expense)) {
      lowConfidenceCount += 1;
    }
  }

  const trustScore = absoluteAmount > 0
    ? Number((weightedAmount / absoluteAmount).toFixed(3))
    : null;
  const trustedSpendShare = absoluteAmount > 0
    ? Number((trustedSpend / absoluteAmount).toFixed(3))
    : null;

  return {
    expense_count: rows.length,
    trusted_count: trustedCount,
    low_confidence_count: lowConfidenceCount,
    trusted_spend_share: trustedSpendShare,
    trust_score: trustScore,
  };
}

module.exports = {
  categoryProvenanceWeight,
  isTrustedCategoryAssignment,
  isLowConfidenceCategoryAssignment,
  summarizeCategoryProvenance,
};
