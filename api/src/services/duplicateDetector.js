const Expense = require('../models/expense');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseReceiptDetail = require('../models/expenseReceiptDetail');
const ExpenseSourceObservation = require('../models/expenseSourceObservation');
const ExpenseItem = require('../models/expenseItem');
const {
  basketSimilarity,
  canonicalMerchantKey,
} = require('./matchPrimitives');
const { scoreMatch } = require('./matchScoring');
const MatchDecision = require('../models/matchDecision');

function scoreCandidate(expense, candidate, {
  locationMatch = false,
  transactionIdMatch = false,
  basketMatch = 0,
  learnedDifferent = false,
} = {}) {
  const { evidence, ...result } = scoreMatch(expense, candidate, {
    profile: 'duplicate',
    placeMatch: locationMatch,
    transactionMatch: transactionIdMatch,
    basketSimilarity: basketMatch,
    learnedDifferent,
  });
  return result;
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
    const learnedDifferent = await MatchDecision.isDuplicatePatternDifferent({
      userId,
      left: matchExpense,
      right: match.candidate,
    });
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
        learnedDifferent,
      }),
    };
  }))).filter(Boolean);

  const flags = [];
  for (const { candidate, confidence, score, reasons } of matches) {
    if (await MatchDecision.isExpensePairDifferent({
      userId,
      expenseIdA: id,
      expenseIdB: candidate.id,
    })) continue;
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
