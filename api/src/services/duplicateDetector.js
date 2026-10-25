const Expense = require('../models/expense');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseReceiptDetail = require('../models/expenseReceiptDetail');
const ExpenseSourceObservation = require('../models/expenseSourceObservation');
const ExpenseItem = require('../models/expenseItem');
const {
  basketSimilarity,
  canonicalMerchantKey,
  daysBetween,
} = require('./matchPrimitives');

function scoreCandidate(expense, candidate, {
  locationMatch = false,
  transactionIdMatch = false,
  basketMatch = 0,
} = {}) {
  const reasons = [];
  let score = 0;
  const amountDistance = Math.abs(Number(candidate.amount) - Number(expense.amount));
  const dateDistance = daysBetween(candidate.date, expense.date);
  const merchantMatch = Boolean(
    expense.merchant_entity_id
      && candidate.merchant_entity_id
      && expense.merchant_entity_id === candidate.merchant_entity_id
  ) || canonicalMerchantKey(candidate.merchant) === canonicalMerchantKey(expense.merchant);
  const paymentMatch = Boolean(
    expense.payment_instrument_id
      && candidate.payment_instrument_id
      && expense.payment_instrument_id === candidate.payment_instrument_id
  );

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
  if (paymentMatch || (expense.card_last4 && candidate.card_last4 && expense.card_last4 === candidate.card_last4)) {
    score += 15;
    reasons.push(paymentMatch ? 'Same payment method' : 'Same card');
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

  const { id } = expense;
  const persistedExpense = id ? await Expense.findById(id).catch(() => null) : null;
  const matchExpense = { ...expense, ...(persistedExpense || {}) };
  const {
    merchant,
    amount,
    date,
    mapkit_stable_id,
    place_entity_id,
  } = matchExpense;

  const fuzzyCandidates = await Expense.findPotentialDuplicates({
    householdId,
    userId,
    merchant,
    amount,
    date,
    excludeId: id,
    allowMerchantMismatch: true,
  });

  const candidates = new Map(fuzzyCandidates.map((candidate) => [candidate.id, {
    candidate,
    locationMatch: false,
    transactionIdMatch: false,
  }]));

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
      const existing = candidates.get(candidate.id) || { candidate, transactionIdMatch: false };
      candidates.set(candidate.id, { ...existing, locationMatch: true });
    }
  }

  if (place_entity_id) {
    const placeCandidates = await Expense.findByPlaceEntityId({
      householdId,
      userId,
      placeEntityId: place_entity_id,
      amount,
      date,
      excludeId: id,
    });
    for (const candidate of placeCandidates) {
      const existing = candidates.get(candidate.id) || { candidate, transactionIdMatch: false };
      candidates.set(candidate.id, { ...existing, locationMatch: true });
    }
  }

  const persistedReceipt = id
    ? await ExpenseReceiptDetail.findByExpenseId(id).catch(() => null)
    : null;
  const observedTransactionIds = id
    ? await ExpenseSourceObservation.findTransactionIdsForExpense(id).catch(() => [])
    : [];
  const transactionIds = [...new Set([
    expense.receipt_details?.transaction_id,
    persistedReceipt?.transaction_id,
    expense.external_transaction_id,
    ...observedTransactionIds,
  ].map((value) => `${value || ''}`.trim()).filter(Boolean))];

  const transactionCandidateGroups = [];
  if (transactionIds.length) {
    transactionCandidateGroups.push(...await Promise.all(transactionIds.map((transactionId) => (
      ExpenseReceiptDetail.findPotentialDuplicates({
        householdId,
        userId,
        transactionId,
        date,
        excludeId: id,
      })
    ))));
  }
  if (transactionIds.length) {
    transactionCandidateGroups.push(await ExpenseSourceObservation.findPotentialTransactionDuplicates({
      householdId,
      userId,
      transactionIds,
      date,
      excludeId: id,
    }));
  }
  for (const candidate of transactionCandidateGroups.flat()) {
    const merchantIdentityMatch = Boolean(
      matchExpense.merchant_entity_id
        && candidate.merchant_entity_id
        && matchExpense.merchant_entity_id === candidate.merchant_entity_id
    );
    if (!merchantIdentityMatch
      && canonicalMerchantKey(candidate.merchant) !== canonicalMerchantKey(matchExpense.merchant)) continue;
    const existing = candidates.get(candidate.id) || { candidate, locationMatch: false };
    candidates.set(candidate.id, { ...existing, transactionIdMatch: true });
  }

  const currentItems = id ? await ExpenseItem.findByExpenseId(id).catch(() => []) : [];
  const matches = (await Promise.all([...candidates.values()].map(async (match) => {
    const candidateItems = match.candidate?.id
      ? await ExpenseItem.findByExpenseId(match.candidate.id).catch(() => [])
      : [];
    const basketMatch = basketSimilarity(currentItems, candidateItems);
    const merchantMatch = Boolean(
      matchExpense.merchant_entity_id
        && match.candidate.merchant_entity_id
        && matchExpense.merchant_entity_id === match.candidate.merchant_entity_id
    ) || canonicalMerchantKey(match.candidate.merchant) === canonicalMerchantKey(matchExpense.merchant);
    if (!merchantMatch && !match.locationMatch && !match.transactionIdMatch && basketMatch < 0.6) return null;
    return {
      candidate: match.candidate,
      ...scoreCandidate(matchExpense, match.candidate, {
        basketMatch,
        locationMatch: match.locationMatch,
        transactionIdMatch: match.transactionIdMatch,
      }),
    };
  }))).filter(Boolean);

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

  return flags;
}

module.exports = detectDuplicates;
module.exports.scoreCandidate = scoreCandidate;
module.exports.basketSimilarity = basketSimilarity;
