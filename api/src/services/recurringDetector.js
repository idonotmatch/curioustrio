const db = require('../db');

async function detectRecurring(householdId) {
  const result = await db.query(
    `SELECT LOWER(merchant) as merchant, amount, date
     FROM expenses
     WHERE household_id = $1
       AND status = 'confirmed'
       AND date >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY merchant, date`,
    [householdId]
  );

  const groups = {};
  for (const row of result.rows) {
    const key = row.merchant;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ amount: Number(row.amount), date: new Date(row.date) });
  }

  const candidates = [];

  for (const [merchant, occurrences] of Object.entries(groups)) {
    if (occurrences.length < 3) continue;

    const gaps = [];
    for (let i = 1; i < occurrences.length; i++) {
      const diffMs = occurrences[i].date - occurrences[i - 1].date;
      gaps.push(Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const gapConsistent = gaps.every(g => Math.abs(g - medianGap) <= 5);
    if (!gapConsistent) continue;

    const amounts = occurrences.map(o => o.amount);
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const medianAmount = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    const amountConsistent = amounts.every(a => Math.abs(a - medianAmount) / medianAmount <= 0.1);
    if (!amountConsistent) continue;

    let frequency;
    if (medianGap <= 2) frequency = 'daily';
    else if (medianGap <= 10) frequency = 'weekly';
    else if (medianGap <= 45) frequency = 'monthly';
    else frequency = 'yearly';

    const lastDate = occurrences[occurrences.length - 1].date;
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + medianGap);

    candidates.push({
      merchant,
      medianAmount,
      frequency,
      nextExpectedDate: nextDate.toISOString().split('T')[0],
      occurrenceCount: occurrences.length,
    });
  }

  return candidates;
}

module.exports = { detectRecurring };
