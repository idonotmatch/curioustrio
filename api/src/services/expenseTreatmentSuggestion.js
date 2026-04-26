const Expense = require('../models/expense');

function normalizeText(value = '') {
  return `${value || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptionTokens(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !['the', 'and', 'for', 'with', 'from'].includes(token));
}

function descriptionOverlapScore(a = '', b = '') {
  const left = new Set(descriptionTokens(a));
  const right = new Set(descriptionTokens(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function labelBudgetExclusionReason(value = '') {
  const labels = {
    business: 'Business',
    reimbursable: 'Reimbursable',
    another_budget: 'Different budget',
    shared_not_mine: 'Shared, not mine',
    transfer_like: 'Transfer-like',
    other: 'Other',
  };
  return labels[value] || null;
}

function majorityBy(candidates = [], selector) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const value = selector(candidate);
    if (value == null) continue;
    const key = JSON.stringify(value);
    const current = grouped.get(key) || { count: 0, value };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count)[0] || null;
}

async function buildExpenseTreatmentSuggestion(expense, userId) {
  if (!expense?.id || !userId) return null;
  const candidates = await Expense.findTreatmentCandidates({
    userId,
    merchant: expense.merchant,
    categoryId: expense.category_id,
    excludeId: expense.id,
  });

  const merchantNorm = normalizeText(expense.merchant);
  const descriptionNorm = normalizeText(expense.description || expense.notes || '');
  const qualified = [];

  for (const candidate of candidates) {
    let score = 0;
    const sameMerchant = merchantNorm && normalizeText(candidate.merchant) === merchantNorm;
    const sameCategory = expense.category_id && candidate.category_id && `${candidate.category_id}` === `${expense.category_id}`;
    const overlap = descriptionOverlapScore(descriptionNorm, candidate.description || '');
    const amountDelta = Math.abs(Number(candidate.amount || 0) - Number(expense.amount || 0));
    const amountClose = amountDelta <= Math.max(12, Math.abs(Number(expense.amount || 0)) * 0.25);

    if (sameMerchant) score += 1.25;
    if (sameCategory) score += 1;
    if (overlap >= 0.5) score += 1;
    if (amountClose) score += 0.5;

    if (score >= 2) qualified.push(candidate);
  }

  if (qualified.length < 2) return null;

  const grouped = new Map();
  for (const candidate of qualified) {
    const key = JSON.stringify({
      is_private: !!candidate.is_private,
      exclude_from_budget: !!candidate.exclude_from_budget,
      budget_exclusion_reason: candidate.exclude_from_budget ? (candidate.budget_exclusion_reason || null) : null,
    });
    const current = grouped.get(key) || { count: 0, candidate };
    current.count += 1;
    grouped.set(key, current);
  }

  const top = [...grouped.values()].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count < 2 || top.count / qualified.length < 0.75) return null;

  const template = top.candidate;
  const suggestedPrivate = !!template.is_private;
  const suggestedTrackOnly = !!template.exclude_from_budget;
  const suggestedReason = suggestedTrackOnly ? (template.budget_exclusion_reason || null) : null;

  const suggestedCategory = (() => {
    const majority = majorityBy(
      qualified.filter((candidate) => candidate.category_id),
      (candidate) => ({ id: candidate.category_id, name: candidate.category_name || null })
    );
    return majority && majority.count >= 2 && majority.count / qualified.length >= 0.75
      ? majority.value
      : null;
  })();

  const suggestedPayment = (() => {
    const majority = majorityBy(
      qualified.filter((candidate) => candidate.payment_method && candidate.payment_method !== 'unknown'),
      (candidate) => ({
        payment_method: candidate.payment_method,
        card_label: candidate.card_label || null,
        card_last4: candidate.card_last4 || null,
      })
    );
    return majority && majority.count >= 2 && majority.count / qualified.length >= 0.75
      ? majority.value
      : null;
  })();

  if (!suggestedPrivate && !suggestedTrackOnly && !suggestedCategory && !suggestedPayment) return null;

  const parts = [];
  if (suggestedTrackOnly) {
    parts.push(`tracked only${suggestedReason ? ` as ${labelBudgetExclusionReason(suggestedReason)?.toLowerCase() || 'track only'}` : ''}`);
  }
  if (suggestedPrivate) {
    parts.push(suggestedTrackOnly ? 'kept private too' : 'kept private');
  }
  if (suggestedCategory?.name) {
    parts.push(`categorized as ${suggestedCategory.name}`);
  }
  if (suggestedPayment?.payment_method) {
    parts.push(`paid with ${suggestedPayment.payment_method}`);
  }

  return {
    suggested_private: suggestedPrivate,
    suggested_track_only: suggestedTrackOnly,
    budget_exclusion_reason: suggestedReason,
    reason_label: labelBudgetExclusionReason(suggestedReason),
    suggested_category_id: suggestedCategory?.id || null,
    suggested_category_name: suggestedCategory?.name || null,
    suggested_payment_method: suggestedPayment?.payment_method || null,
    suggested_card_label: suggestedPayment?.card_label || null,
    suggested_card_last4: suggestedPayment?.card_last4 || null,
    matched_count: top.count,
    basis_count: qualified.length,
    summary: `You usually ${parts.join(' and ')} for similar expenses.`,
    detail: `${top.count} of ${qualified.length} similar confirmed expenses were handled this way.`,
  };
}

module.exports = {
  buildExpenseTreatmentSuggestion,
};
