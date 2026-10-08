const Expense = require('../models/expense');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseReceiptDetail = require('../models/expenseReceiptDetail');
const ExpenseItem = require('../models/expenseItem');
const { canonicalMerchantKey } = require('./merchantIdentity');
const { normalizeComparableDescription } = require('./itemNormalizer');

function normalizeDate(d) {
  return new Date(d).toISOString().split('T')[0];
}

function normalizeMerchant(value) {
  return canonicalMerchantKey(value);
}

function basketItemKey(item = {}) {
  if (item.product_id) return `product:${item.product_id}`;
  if (item.comparable_key) return `comparable:${item.comparable_key}`;
  const normalized = item.normalized_name || normalizeComparableDescription(item.description || item.raw_description);
  return normalized ? `name:${normalized}` : null;
}

function basketSimilarity(leftItems = [], rightItems = []) {
  const left = new Set(leftItems.map(basketItemKey).filter(Boolean));
  const right = new Set(rightItems.map(basketItemKey).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach((key) => { if (right.has(key)) overlap += 1; });
  return Number((overlap / Math.max(left.size, right.size)).toFixed(3));
}

function dateDistanceDays(left, right) {
  return Math.abs((new Date(`${normalizeDate(left)}T12:00:00Z`) - new Date(`${normalizeDate(right)}T12:00:00Z`)) / 86400000);
}

function scoreCandidate(expense, candidate, { locationMatch = false, transactionIdMatch = false, basketMatch = 0 } = {}) {
  const reasons = [];
  let score = 0;
  const amountDistance = Math.abs(Number(candidate.amount) - Number(expense.amount));
  const dateDistance = dateDistanceDays(candidate.date, expense.date);
  const merchantMatch = normalizeMerchant(candidate.merchant) === normalizeMerchant(expense.merchant);

  if (merchantMatch) {
    score += 30;
    reasons.push('Same merchant');
  }
  if (amountDistance < 0.005) {
    score += 40;
    reasons.push('Same amount');
  } else if (amountDistance <= 1) {
    score += 20;
    reasons.push('Amount within $1');
  }
  if (dateDistance === 0) {
    score += 30;
    reasons.push('Same date');
  } else if (dateDistance === 1) {
    score += 20;
    reasons.push('Dates one day apart');
  } else if (dateDistance === 2) {
    score += 10;
    reasons.push('Dates two days apart');
  }
  if (expense.card_last4 && candidate.card_last4 && expense.card_last4 === candidate.card_last4) {
    score += 15;
    reasons.push('Same card');
  }
  if (locationMatch) {
    score += 15;
    reasons.push('Same location');
  }
  if (transactionIdMatch) {
    score += 100;
    reasons.push('Same receipt transaction ID');
  }
  if (basketMatch >= 0.6) {
    score += 35;
    reasons.push(`Same basket (${Math.round(basketMatch * 100)}%)`);
  } else if (basketMatch >= 0.4) {
    score += 15;
    reasons.push(`Similar basket (${Math.round(basketMatch * 100)}%)`);
  }

  const exact = transactionIdMatch || (merchantMatch && amountDistance < 0.005 && dateDistance === 0);
  return {
    score,
    reasons,
    confidence: exact ? 'exact' : score >= 60 ? 'fuzzy' : 'uncertain',
  };
}

async function detectDuplicates(expense) {
  const householdId = expense.householdId || expense.household_id || null;
  const userId = expense.userId || expense.user_id || null;
  if (!householdId && !userId) return [];

  const { id, merchant, amount, date, mapkit_stable_id } = expense;

  // Step 2: Find fuzzy/exact candidates by merchant+amount+date
  const fuzzyCandidates = await Expense.findPotentialDuplicates({
    householdId,
    userId,
    merchant,
    amount,
    date,
    excludeId: id,
    allowMerchantMismatch: true,
  });

  // Track found ids to deduplicate location matches
  const foundIds = new Set(fuzzyCandidates.map(c => c.id));

  // Step 3: Determine confidence for each fuzzy candidate
  const currentItems = id ? await ExpenseItem.findByExpenseId(id).catch(() => []) : [];
  const matches = (await Promise.all(fuzzyCandidates.map(async (candidate) => {
    const candidateItems = candidate?.id
      ? await ExpenseItem.findByExpenseId(candidate.id).catch(() => [])
      : [];
    const basketMatch = basketSimilarity(currentItems, candidateItems);
    const merchantMatch = normalizeMerchant(candidate.merchant) === normalizeMerchant(expense.merchant);
    if (!merchantMatch && basketMatch < 0.6) return null;
    return { candidate, ...scoreCandidate(expense, candidate, { basketMatch }) };
  }))).filter(Boolean);

  // Step 4: Location-based matches via mapkit_stable_id
  if (mapkit_stable_id) {
    const locationCandidates = await Expense.findByMapkitStableId({
      householdId,
      userId,
      mapkitStableId: mapkit_stable_id,
      amount,
      date,
      excludeId: id,
    });

    for (const candidate of locationCandidates) {
      if (!foundIds.has(candidate.id)) {
        foundIds.add(candidate.id);
        matches.push({ candidate, ...scoreCandidate(expense, candidate, { locationMatch: true }) });
      }
    }
  }

  const transactionId = expense.receipt_details?.transaction_id || null;
  if (transactionId) {
    const transactionCandidates = await ExpenseReceiptDetail.findPotentialDuplicates({
      householdId,
      userId,
      transactionId,
      date,
      excludeId: id,
    });
    for (const candidate of transactionCandidates) {
      if (foundIds.has(candidate.id)) continue;
      if (normalizeMerchant(candidate.merchant) !== normalizeMerchant(expense.merchant)) continue;
      foundIds.add(candidate.id);
      matches.push({ candidate, ...scoreCandidate(expense, candidate, { transactionIdMatch: true }) });
    }
  }

  // Step 5: Create DuplicateFlag rows for each unique match
  const flags = [];
  for (const { candidate, confidence, score, reasons } of matches) {
    const flag = await DuplicateFlag.create({
      expenseIdA: id,
      expenseIdB: candidate.id,
      confidence,
      score,
      matchReasons: reasons,
    });
    flags.push(flag);
  }

  // Step 6: Return all created flag rows
  return flags;
}

module.exports = detectDuplicates;
module.exports.scoreCandidate = scoreCandidate;
module.exports.basketSimilarity = basketSimilarity;
