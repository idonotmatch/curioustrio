const db = require('../db');

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function classifyFrequency(medianGap) {
  if (medianGap <= 2) return 'daily';
  if (medianGap <= 10) return 'weekly';
  if (medianGap <= 45) return 'monthly';
  return 'yearly';
}

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

    const medianGap = median(gaps);
    const gapConsistent = gaps.every(g => Math.abs(g - medianGap) <= 5);
    if (!gapConsistent) continue;

    const amounts = occurrences.map(o => o.amount);
    const medianAmount = median(amounts);
    const amountConsistent = amounts.every(a => Math.abs(a - medianAmount) / medianAmount <= 0.1);
    if (!amountConsistent) continue;

    const frequency = classifyFrequency(medianGap);

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

async function detectRecurringItems(householdId) {
  const result = await db.query(
    `SELECT
       ei.product_id,
       ei.comparable_key,
       COALESCE(p.name, ei.description) AS item_name,
       COALESCE(p.brand, ei.brand) AS brand,
       ei.normalized_total_size_value,
       ei.normalized_total_size_unit,
       ei.estimated_unit_price,
       ei.amount AS item_amount,
       e.merchant,
       e.date
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     LEFT JOIN products p ON p.id = ei.product_id
     WHERE e.household_id = $1
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
     ORDER BY e.date ASC`,
    [householdId]
  );

  const groups = new Map();
  for (const row of result.rows) {
    const key = row.product_id ? `product:${row.product_id}` : `comparable:${row.comparable_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      product_id: row.product_id || null,
      comparable_key: row.comparable_key || null,
      item_name: row.item_name,
      brand: row.brand || null,
      merchant: row.merchant,
      item_amount: row.item_amount == null ? null : Number(row.item_amount),
      estimated_unit_price: row.estimated_unit_price == null ? null : Number(row.estimated_unit_price),
      normalized_total_size_value: row.normalized_total_size_value == null ? null : Number(row.normalized_total_size_value),
      normalized_total_size_unit: row.normalized_total_size_unit || null,
      date: new Date(row.date),
    });
  }

  const candidates = [];
  for (const [groupKey, occurrences] of groups.entries()) {
    if (occurrences.length < 3) continue;

    const dates = occurrences.map(o => o.date).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)));
    }
    const medianGap = median(gaps);
    if (medianGap == null) continue;
    const gapConsistent = gaps.every(g => Math.abs(g - medianGap) <= 7);
    if (!gapConsistent) continue;

    const prices = occurrences.map(o => o.item_amount).filter(v => v != null);
    const medianPrice = median(prices);
    const priceConsistent = medianPrice != null
      ? prices.every(a => Math.abs(a - medianPrice) / Math.max(medianPrice, 0.01) <= 0.2)
      : false;
    if (!priceConsistent) continue;

    const unitPrices = occurrences.map(o => o.estimated_unit_price).filter(v => v != null);
    const medianUnitPrice = unitPrices.length ? median(unitPrices) : null;
    const merchants = [...new Set(occurrences.map(o => o.merchant).filter(Boolean))];
    const lastOccurrence = dates[dates.length - 1];
    const nextDate = new Date(lastOccurrence);
    nextDate.setDate(nextDate.getDate() + medianGap);

    candidates.push({
      kind: 'item',
      group_key: groupKey,
      product_id: occurrences[0].product_id,
      comparable_key: occurrences[0].comparable_key,
      item_name: occurrences[0].item_name,
      brand: occurrences[0].brand,
      frequency: classifyFrequency(medianGap),
      average_gap_days: medianGap,
      occurrence_count: occurrences.length,
      median_amount: medianPrice,
      median_unit_price: medianUnitPrice,
      last_purchased_at: lastOccurrence.toISOString().split('T')[0],
      next_expected_date: nextDate.toISOString().split('T')[0],
      merchants,
      normalized_total_size_value: occurrences[0].normalized_total_size_value,
      normalized_total_size_unit: occurrences[0].normalized_total_size_unit,
    });
  }

  return candidates.sort((a, b) => b.occurrence_count - a.occurrence_count || a.item_name.localeCompare(b.item_name));
}

module.exports = { detectRecurring, detectRecurringItems };
