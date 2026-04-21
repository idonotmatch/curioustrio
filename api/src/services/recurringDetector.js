const db = require('../db');
const RecurringPreference = require('../models/recurringPreference');

function isMissingExcludeFromBudgetError(err) {
  return err?.code === '42703' && /exclude_from_budget/i.test(`${err?.message || ''}`);
}

async function queryBudgetRelevant(sql, params, fallbackSql) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    if (!isMissingExcludeFromBudgetError(err) || !fallbackSql) throw err;
    return db.query(fallbackSql, params);
  }
}

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

function recurringExpenseScopeClause(scope = 'household', paramIndex = 1) {
  if (scope === 'personal') return `e.user_id = $${paramIndex}`;
  return `e.household_id = $${paramIndex}`;
}

async function loadRecurringItemOccurrences(ownerId, options = {}) {
  const scope = options.scope === 'personal' ? 'personal' : 'household';
  const result = await queryBudgetRelevant(
    `SELECT
       ei.expense_id,
       ei.product_id,
       ei.comparable_key,
       ei.product_match_confidence,
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
     WHERE ${recurringExpenseScopeClause(scope, 1)}
       AND e.status = 'confirmed'
       AND e.exclude_from_budget = FALSE
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
     ORDER BY e.date ASC`,
    [ownerId],
    `SELECT
       ei.expense_id,
       ei.product_id,
       ei.comparable_key,
       ei.product_match_confidence,
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
     WHERE ${recurringExpenseScopeClause(scope, 1)}
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
     ORDER BY e.date ASC`
  );

  const groups = new Map();
  for (const row of result.rows) {
    const key = row.product_id ? `product:${row.product_id}` : `comparable:${row.comparable_key}`;
    if (!groups.has(key)) groups.set(key, []);
    const dateOnly = row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : `${row.date}`.slice(0, 10);
    groups.get(key).push({
      expense_id: row.expense_id || null,
      product_id: row.product_id || null,
      comparable_key: row.comparable_key || null,
      product_match_confidence: row.product_match_confidence || null,
      item_name: row.item_name,
      brand: row.brand || null,
      merchant: row.merchant,
      item_amount: row.item_amount == null ? null : Number(row.item_amount),
      estimated_unit_price: row.estimated_unit_price == null ? null : Number(row.estimated_unit_price),
      normalized_total_size_value: row.normalized_total_size_value == null ? null : Number(row.normalized_total_size_value),
      normalized_total_size_unit: row.normalized_total_size_unit || null,
      date: parseDateOnly(dateOnly),
    });
  }
  return groups;
}

async function detectRecurring(householdId) {
  const result = await queryBudgetRelevant(
    `SELECT LOWER(merchant) as merchant, amount, date
     FROM expenses
     WHERE household_id = $1
       AND status = 'confirmed'
       AND exclude_from_budget = FALSE
       AND date >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY merchant, date`,
    [householdId],
    `SELECT LOWER(merchant) as merchant, amount, date
     FROM expenses
     WHERE household_id = $1
       AND status = 'confirmed'
       AND date >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY merchant, date`
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

async function detectRecurringItems(ownerId, options = {}) {
  const groups = await loadRecurringItemOccurrences(ownerId, options);

  const candidates = [];
  for (const [groupKey, occurrences] of groups.entries()) {
    const hasStrongProductIdentity = occurrences.some((entry) => entry.product_id);
    const hasOnlyMediumComparableIdentity = !hasStrongProductIdentity
      && occurrences.every((entry) => entry.comparable_key && entry.product_match_confidence === 'medium');

    if (hasOnlyMediumComparableIdentity && occurrences.length < 4) continue;

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
      identity_confidence: hasStrongProductIdentity ? 'high' : 'medium',
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

async function getRecurringItemHistory(ownerId, groupKey, options = {}) {
  const groups = await loadRecurringItemOccurrences(ownerId, options);
  const history = groups.get(groupKey);
  if (!history || !history.length) return null;

  const sorted = [...history].sort((a, b) => a.date - b.date);
  const dates = sorted.map(o => o.date);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)));
  }

  const averageGapDays = gaps.length ? median(gaps) : null;
  const amounts = sorted.map(o => o.item_amount).filter(v => v != null);
  const unitPrices = sorted.map(o => o.estimated_unit_price).filter(v => v != null);
  const merchants = [...new Set(sorted.map(o => o.merchant).filter(Boolean))];
  const merchantPriceHistory = merchants.map((merchant) => {
    const merchantEntries = sorted.filter((entry) => entry.merchant === merchant);
    const merchantAmounts = merchantEntries.map((entry) => entry.item_amount).filter(v => v != null);
    const merchantUnitPrices = merchantEntries.map((entry) => entry.estimated_unit_price).filter(v => v != null);
    return {
      merchant,
      occurrence_count: merchantEntries.length,
      median_amount: merchantAmounts.length ? median(merchantAmounts) : null,
      median_unit_price: merchantUnitPrices.length ? median(merchantUnitPrices) : null,
    };
  }).sort((a, b) => a.merchant.localeCompare(b.merchant));

  const latest = sorted[sorted.length - 1];
  const nextExpected = averageGapDays != null ? new Date(latest.date) : null;
  if (nextExpected) nextExpected.setDate(nextExpected.getDate() + averageGapDays);

  return {
    kind: 'item_history',
    group_key: groupKey,
    product_id: latest.product_id,
    comparable_key: latest.comparable_key,
    identity_confidence: latest.product_id ? 'high' : (latest.product_match_confidence || null),
    item_name: latest.item_name,
    brand: latest.brand,
    frequency: averageGapDays != null ? classifyFrequency(averageGapDays) : null,
    average_gap_days: averageGapDays,
    occurrence_count: sorted.length,
    median_amount: amounts.length ? median(amounts) : null,
    median_unit_price: unitPrices.length ? median(unitPrices) : null,
    first_purchased_at: sorted[0].date.toISOString().split('T')[0],
    last_purchased_at: latest.date.toISOString().split('T')[0],
    next_expected_date: nextExpected ? nextExpected.toISOString().split('T')[0] : null,
    merchants,
    merchant_price_history: merchantPriceHistory,
    normalized_total_size_value: latest.normalized_total_size_value,
    normalized_total_size_unit: latest.normalized_total_size_unit,
    purchases: sorted.map((entry) => ({
      id: entry.expense_id || null,
      date: entry.date.toISOString().split('T')[0],
      merchant: entry.merchant,
      item_amount: entry.item_amount,
      estimated_unit_price: entry.estimated_unit_price,
      normalized_total_size_value: entry.normalized_total_size_value,
      normalized_total_size_unit: entry.normalized_total_size_unit,
    })),
  };
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function parseDateOnly(dateString) {
  if (dateString instanceof Date) {
    return new Date(dateString.getFullYear(), dateString.getMonth(), dateString.getDate(), 12, 0, 0, 0);
  }
  const [year, month, day] = `${dateString}`.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function diffDays(from, to) {
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

async function detectRecurringWatchCandidates(ownerId, options = {}) {
  const scope = options.scope === 'personal' ? 'personal' : 'household';
  const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : 5;
  const maxOverdueDays = Number.isFinite(options.maxOverdueDays) ? options.maxOverdueDays : 7;
  const recurringItems = await detectRecurringItems(ownerId, { scope });
  const today = parseDateOnly(startOfToday().toISOString().split('T')[0]);
  const automaticCandidates = recurringItems
    .filter((item) => item.product_id || item.comparable_key)
    .map((item) => {
      const nextExpectedDate = parseDateOnly(item.next_expected_date);
      const daysUntilDue = diffDays(today, nextExpectedDate);
      const watchStartsAt = new Date(nextExpectedDate);
      watchStartsAt.setDate(watchStartsAt.getDate() - windowDays);
      const daysUntilWatch = diffDays(today, watchStartsAt);

      let status = 'upcoming';
      if (daysUntilDue < 0) status = 'overdue';
      else if (daysUntilDue === 0) status = 'due_today';
      else if (daysUntilDue <= windowDays) status = 'watching';

      return {
        kind: 'watch_candidate',
        group_key: item.group_key,
        product_id: item.product_id,
        identity_confidence: item.identity_confidence || null,
        item_name: item.item_name,
        brand: item.brand,
        occurrence_count: item.occurrence_count,
        average_gap_days: item.average_gap_days,
        median_amount: item.median_amount,
        median_unit_price: item.median_unit_price,
        last_purchased_at: item.last_purchased_at,
        next_expected_date: item.next_expected_date,
        watch_starts_at: watchStartsAt.toISOString().split('T')[0],
        days_until_watch: daysUntilWatch,
        days_until_due: daysUntilDue,
        status,
        merchants: item.merchants,
        normalized_total_size_value: item.normalized_total_size_value,
        normalized_total_size_unit: item.normalized_total_size_unit,
      };
    })
    .filter((item) => item.days_until_due <= windowDays && item.days_until_due >= -maxOverdueDays);

  const preferences = scope === 'household'
    ? await RecurringPreference.findByHousehold(ownerId)
    : [];
  const automaticByKey = new Map(
    automaticCandidates.map((candidate) => [candidate.product_id ? `product:${candidate.product_id}` : candidate.group_key, candidate])
  );

  for (const pref of preferences) {
    const identityKey = pref.product_id
      ? `product:${pref.product_id}`
      : pref.comparable_key
        ? `comparable:${pref.comparable_key}`
        : `expense:${pref.expense_id}`;
    if (automaticByKey.has(identityKey)) {
      const existing = automaticByKey.get(identityKey);
      if (pref.expected_frequency_days && pref.expected_frequency_days > 0) {
        const nextExpectedDate = parseDateOnly(existing.last_purchased_at);
        nextExpectedDate.setDate(nextExpectedDate.getDate() + pref.expected_frequency_days);
        const daysUntilDue = diffDays(today, nextExpectedDate);
        const watchStartsAt = new Date(nextExpectedDate);
        watchStartsAt.setDate(watchStartsAt.getDate() - windowDays);
        existing.average_gap_days = pref.expected_frequency_days;
        existing.next_expected_date = nextExpectedDate.toISOString().split('T')[0];
        existing.watch_starts_at = watchStartsAt.toISOString().split('T')[0];
        existing.days_until_watch = diffDays(today, watchStartsAt);
        existing.days_until_due = daysUntilDue;
        existing.status = daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : daysUntilDue <= windowDays ? 'watching' : 'upcoming';
      }
      existing.source = 'manual';
      existing.notes = pref.notes || existing.notes || null;
      existing.manual_preference_id = pref.id;
      continue;
    }

    if (!pref.expected_frequency_days || pref.expected_frequency_days <= 0) continue;
    const expenseResult = await db.query(
      `SELECT date, amount FROM expenses WHERE id = $1 AND household_id = $2`,
      [pref.expense_id, ownerId]
    );
    const sourceExpense = expenseResult.rows[0];
    if (!sourceExpense?.date) continue;

    const lastPurchasedAt = parseDateOnly(sourceExpense.date);
    const nextExpectedDate = new Date(lastPurchasedAt);
    nextExpectedDate.setDate(nextExpectedDate.getDate() + pref.expected_frequency_days);
    const daysUntilDue = diffDays(today, nextExpectedDate);
    const watchStartsAt = new Date(nextExpectedDate);
    watchStartsAt.setDate(watchStartsAt.getDate() - windowDays);
    if (daysUntilDue > windowDays || daysUntilDue < -maxOverdueDays) continue;

    automaticByKey.set(identityKey, {
      kind: 'watch_candidate',
      group_key: pref.product_id ? `product:${pref.product_id}` : pref.comparable_key ? `comparable:${pref.comparable_key}` : `manual:${pref.expense_id}`,
      product_id: pref.product_id,
      identity_confidence: pref.product_id ? 'high' : (pref.comparable_key ? 'medium' : null),
      item_name: pref.item_name || pref.merchant || 'Recurring purchase',
      brand: pref.brand || null,
      occurrence_count: 1,
      average_gap_days: pref.expected_frequency_days,
      median_amount: sourceExpense.amount == null ? null : Number(sourceExpense.amount),
      median_unit_price: null,
      last_purchased_at: lastPurchasedAt.toISOString().split('T')[0],
      next_expected_date: nextExpectedDate.toISOString().split('T')[0],
      watch_starts_at: watchStartsAt.toISOString().split('T')[0],
      days_until_watch: diffDays(today, watchStartsAt),
      days_until_due: daysUntilDue,
      status: daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : daysUntilDue <= windowDays ? 'watching' : 'upcoming',
      merchants: pref.merchant ? [pref.merchant] : [],
      normalized_total_size_value: null,
      normalized_total_size_unit: null,
      source: 'manual',
      notes: pref.notes || null,
      manual_preference_id: pref.id,
    });
  }

  return [...automaticByKey.values()]
    .filter((item) => item.days_until_due <= windowDays && item.days_until_due >= -maxOverdueDays)
    .sort((a, b) => a.days_until_due - b.days_until_due || b.occurrence_count - a.occurrence_count);
}

async function detectRecurringItemSignals(ownerId, options = {}) {
  const groups = await loadRecurringItemOccurrences(ownerId, options);
  const signals = [];
  for (const [groupKey, history] of groups.entries()) {
    if (history.length < 3) continue;

    const sorted = [...history].sort((a, b) => a.date - b.date);
    const latest = sorted[sorted.length - 1];
    const baseline = sorted.slice(0, -1);
    if (baseline.length < 2) continue;

    const baselineDates = baseline.map(x => x.date);
    const baselineGaps = [];
    for (let i = 1; i < baselineDates.length; i++) {
      baselineGaps.push(Math.round((baselineDates[i] - baselineDates[i - 1]) / (1000 * 60 * 60 * 24)));
    }
    const medianGap = baselineGaps.length ? median(baselineGaps) : Math.round((latest.date - baseline[baseline.length - 1].date) / (1000 * 60 * 60 * 24));
    if (medianGap == null) continue;
    const gapConsistent = baselineGaps.length === 0 || baselineGaps.every(g => Math.abs(g - medianGap) <= 7);
    if (!gapConsistent) continue;

    const baselineAmounts = baseline.map(x => x.item_amount).filter(v => v != null);
    const baselineUnitPrices = baseline.map(x => x.estimated_unit_price).filter(v => v != null);
    const baselineAmount = median(baselineAmounts);
    const baselineUnitPrice = baselineUnitPrices.length ? median(baselineUnitPrices) : null;

    const latestComparable = latest.estimated_unit_price ?? latest.item_amount;
    const baselineComparable = baselineUnitPrice ?? baselineAmount;
    const comparisonType = baselineUnitPrice != null && latest.estimated_unit_price != null ? 'unit_price' : 'price';

    if (latestComparable == null || baselineComparable == null || baselineComparable <= 0) continue;

    const deltaAmount = Number((latestComparable - baselineComparable).toFixed(4));
    const deltaPercent = Number(((deltaAmount / baselineComparable) * 100).toFixed(1));
    const absoluteThreshold = comparisonType === 'unit_price' ? 0.05 : 1;
    const meaningfulDelta = Math.abs(deltaAmount) >= absoluteThreshold && Math.abs(deltaPercent) >= 10;

    if (meaningfulDelta) {
      signals.push({
        kind: 'item_price_variance',
        signal: deltaAmount > 0 ? 'price_spike' : 'better_than_usual',
        comparison_type: comparisonType,
        group_key: groupKey,
        product_id: latest.product_id,
        comparable_key: latest.comparable_key,
        identity_confidence: latest.product_id ? 'high' : (latest.product_match_confidence || null),
        item_name: latest.item_name,
        brand: latest.brand,
        latest_merchant: latest.merchant,
        latest_date: latest.date.toISOString().split('T')[0],
        latest_value: latestComparable,
        baseline_value: baselineComparable,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
      });
    }

    if (baselineUnitPrices.length >= 2) {
      const merchantBaselines = {};
      for (const entry of baseline) {
        if (entry.estimated_unit_price == null || !entry.merchant) continue;
        if (!merchantBaselines[entry.merchant]) merchantBaselines[entry.merchant] = [];
        merchantBaselines[entry.merchant].push(entry.estimated_unit_price);
      }

      const merchantMedians = Object.entries(merchantBaselines)
        .map(([merchant, values]) => ({ merchant, median_unit_price: median(values) }))
        .filter(x => x.median_unit_price != null)
        .sort((a, b) => a.median_unit_price - b.median_unit_price);

      const currentMerchantMedian = merchantMedians.find(x => x.merchant === latest.merchant);
      const cheapestMerchant = merchantMedians[0];
      if (
        currentMerchantMedian &&
        cheapestMerchant &&
        cheapestMerchant.merchant !== latest.merchant
      ) {
        const merchantDelta = Number((currentMerchantMedian.median_unit_price - cheapestMerchant.median_unit_price).toFixed(4));
        const merchantDeltaPercent = Number(((merchantDelta / Math.max(cheapestMerchant.median_unit_price, 0.01)) * 100).toFixed(1));
        if (merchantDelta >= 0.05 && merchantDeltaPercent >= 10) {
          signals.push({
            kind: 'item_price_variance',
            signal: 'cheaper_elsewhere',
            comparison_type: 'unit_price',
            group_key: groupKey,
            product_id: latest.product_id,
            comparable_key: latest.comparable_key,
            identity_confidence: latest.product_id ? 'high' : (latest.product_match_confidence || null),
            item_name: latest.item_name,
            brand: latest.brand,
            latest_merchant: latest.merchant,
            latest_date: latest.date.toISOString().split('T')[0],
            latest_value: currentMerchantMedian.median_unit_price,
            baseline_value: cheapestMerchant.median_unit_price,
            delta_amount: merchantDelta,
            delta_percent: merchantDeltaPercent,
            cheaper_merchant: cheapestMerchant.merchant,
          });
        }
      }
    }
  }

  return signals.sort((a, b) => Math.abs(b.delta_percent) - Math.abs(a.delta_percent));
}

module.exports = {
  detectRecurring,
  detectRecurringItems,
  detectRecurringItemSignals,
  getRecurringItemHistory,
  detectRecurringWatchCandidates,
};
