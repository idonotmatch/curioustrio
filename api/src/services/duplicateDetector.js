const Expense = require('../models/expense');
const DuplicateFlag = require('../models/duplicateFlag');

function normalizeDate(d) {
  return new Date(d).toISOString().split('T')[0];
}

async function detectDuplicates(expense) {
  if (!expense.householdId) return [];

  const { id, householdId, merchant, amount, date, mapkit_stable_id } = expense;

  // Step 2: Find fuzzy/exact candidates by merchant+amount+date
  const fuzzyCandidates = await Expense.findPotentialDuplicates({
    householdId,
    merchant,
    amount,
    date,
    excludeId: id,
  });

  // Track found ids to deduplicate location matches
  const foundIds = new Set(fuzzyCandidates.map(c => c.id));

  // Step 3: Determine confidence for each fuzzy candidate
  const matches = fuzzyCandidates.map(candidate => {
    const sameDate = normalizeDate(candidate.date) === date;
    const sameMerchant = candidate.merchant.toLowerCase() === merchant.toLowerCase();
    const sameAmount = Number(candidate.amount) === Number(amount);
    const confidence = (sameDate && sameMerchant && sameAmount) ? 'exact' : 'fuzzy';
    return { candidate, confidence };
  });

  // Step 4: Location-based matches via mapkit_stable_id
  if (mapkit_stable_id) {
    const locationCandidates = await Expense.findByMapkitStableId({
      householdId,
      mapkitStableId: mapkit_stable_id,
      amount,
      date,
      excludeId: id,
    });

    for (const candidate of locationCandidates) {
      if (!foundIds.has(candidate.id)) {
        foundIds.add(candidate.id);
        matches.push({ candidate, confidence: 'uncertain' });
      }
    }
  }

  // Step 5: Create DuplicateFlag rows for each unique match
  const flags = [];
  for (const { candidate, confidence } of matches) {
    const flag = await DuplicateFlag.create({
      expenseIdA: id,
      expenseIdB: candidate.id,
      confidence,
    });
    flags.push(flag);
  }

  // Step 6: Return all created flag rows
  return flags;
}

module.exports = detectDuplicates;
