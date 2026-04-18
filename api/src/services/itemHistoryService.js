const db = require('../db');

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

function expenseScopeClause(scope = 'household', paramIndex = 1) {
  if (scope === 'personal') return `e.user_id = $${paramIndex}`;
  return `e.household_id = $${paramIndex}`;
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4))
    : sorted[mid];
}

function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return `${value || ''}`.slice(0, 10);
}

function parseDateOnly(value) {
  const [year, month, day] = `${value || ''}`.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function buildGroupKey(row = {}) {
  if (row.product_id) return `product:${row.product_id}`;
  if (row.comparable_key) return `comparable:${row.comparable_key}`;
  return null;
}

function summarizeHistoryRows(rows = []) {
  const grouped = new Map();

  for (const row of rows) {
    const groupKey = buildGroupKey(row);
    if (!groupKey) continue;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push({
      group_key: groupKey,
      product_id: row.product_id || null,
      comparable_key: row.comparable_key || null,
      product_match_confidence: row.product_match_confidence || null,
      item_name: row.item_name || row.description || null,
      brand: row.brand || null,
      merchant: row.merchant || null,
      amount: row.item_amount == null ? null : Number(row.item_amount),
      estimated_unit_price: row.estimated_unit_price == null ? null : Number(row.estimated_unit_price),
      normalized_total_size_value: row.normalized_total_size_value == null ? null : Number(row.normalized_total_size_value),
      normalized_total_size_unit: row.normalized_total_size_unit || null,
      date: toDateOnly(row.date),
    });
  }

  return [...grouped.values()].map((entries) => summarizeIdentity(entries))
    .filter(Boolean)
    .sort((a, b) => (
      b.occurrence_count - a.occurrence_count
      || `${b.last_purchased_at}`.localeCompare(`${a.last_purchased_at}`)
      || `${a.item_name || ''}`.localeCompare(`${b.item_name || ''}`)
    ));
}

function summarizeIdentity(entries = []) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const amounts = sorted.map((entry) => entry.amount).filter((value) => value != null);
  const unitPrices = sorted.map((entry) => entry.estimated_unit_price).filter((value) => value != null);
  const merchants = [...new Set(sorted.map((entry) => entry.merchant).filter(Boolean))];
  const dateObjs = sorted.map((entry) => parseDateOnly(entry.date));
  const gaps = [];
  for (let i = 1; i < dateObjs.length; i += 1) {
    gaps.push(Math.round((dateObjs[i] - dateObjs[i - 1]) / (1000 * 60 * 60 * 24)));
  }
  const merchantBreakdown = merchants.map((merchant) => {
    const merchantEntries = sorted.filter((entry) => entry.merchant === merchant);
    const merchantAmounts = merchantEntries.map((entry) => entry.amount).filter((value) => value != null);
    const merchantUnitPrices = merchantEntries.map((entry) => entry.estimated_unit_price).filter((value) => value != null);
    return {
      merchant,
      occurrence_count: merchantEntries.length,
      median_amount: median(merchantAmounts),
      median_unit_price: median(merchantUnitPrices),
      last_purchased_at: merchantEntries[merchantEntries.length - 1]?.date || null,
    };
  }).sort((a, b) => b.occurrence_count - a.occurrence_count || a.merchant.localeCompare(b.merchant));

  return {
    kind: 'item_history',
    group_key: latest.group_key,
    product_id: latest.product_id,
    comparable_key: latest.comparable_key,
    identity_confidence: latest.product_id ? 'high' : (latest.product_match_confidence || 'medium'),
    item_name: latest.item_name,
    brand: latest.brand,
    occurrence_count: sorted.length,
    average_gap_days: gaps.length ? median(gaps) : null,
    median_amount: median(amounts),
    median_unit_price: median(unitPrices),
    first_purchased_at: first.date,
    last_purchased_at: latest.date,
    merchants,
    merchant_breakdown: merchantBreakdown,
    normalized_total_size_value: latest.normalized_total_size_value,
    normalized_total_size_unit: latest.normalized_total_size_unit,
    purchases: sorted.map((entry) => ({
      date: entry.date,
      merchant: entry.merchant,
      amount: entry.amount,
      estimated_unit_price: entry.estimated_unit_price,
      normalized_total_size_value: entry.normalized_total_size_value,
      normalized_total_size_unit: entry.normalized_total_size_unit,
    })),
  };
}

async function loadItemHistoryRows(ownerId, {
  scope = 'household',
  lookbackDays = 180,
  groupKey = null,
} = {}) {
  const values = [ownerId, Math.max(1, Math.min(Number(lookbackDays) || 180, 365))];
  let identityClause = '';

  if (groupKey) {
    if (`${groupKey}`.startsWith('product:')) {
      values.push(groupKey.slice('product:'.length));
      identityClause = `AND ei.product_id = $${values.length}`;
    } else if (`${groupKey}`.startsWith('comparable:')) {
      values.push(groupKey.slice('comparable:'.length));
      identityClause = `AND ei.comparable_key = $${values.length}`;
    } else {
      return [];
    }
  }

  const sharedSelect = `
    SELECT
      ei.product_id,
      ei.comparable_key,
      ei.product_match_confidence,
      COALESCE(p.name, ei.description) AS item_name,
      COALESCE(p.brand, ei.brand) AS brand,
      ei.amount AS item_amount,
      ei.estimated_unit_price,
      ei.normalized_total_size_value,
      ei.normalized_total_size_unit,
      e.merchant,
      e.date
    FROM expense_items ei
    JOIN expenses e ON e.id = ei.expense_id
    LEFT JOIN products p ON p.id = ei.product_id
    WHERE ${expenseScopeClause(scope, 1)}
      AND e.status = 'confirmed'
      AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      AND COALESCE(ei.item_type, 'product') = 'product'
      AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
      ${identityClause}
    ORDER BY e.date DESC`;

  const result = await queryBudgetRelevant(
    sharedSelect.replace(
      `AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`,
      `AND e.exclude_from_budget = FALSE
      AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`
    ),
    values,
    sharedSelect
  );

  return result.rows;
}

async function listItemHistorySummaries(ownerId, {
  scope = 'household',
  lookbackDays = 180,
  minOccurrences = 2,
  limit = 25,
} = {}) {
  const rows = await loadItemHistoryRows(ownerId, { scope, lookbackDays });
  return summarizeHistoryRows(rows)
    .filter((entry) => entry.occurrence_count >= Math.max(1, Number(minOccurrences) || 2))
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 100)));
}

async function getItemHistoryByGroupKey(ownerId, groupKey, {
  scope = 'household',
  lookbackDays = 180,
} = {}) {
  const rows = await loadItemHistoryRows(ownerId, { scope, lookbackDays, groupKey });
  return summarizeHistoryRows(rows)[0] || null;
}

module.exports = {
  summarizeHistoryRows,
  summarizeIdentity,
  listItemHistorySummaries,
  getItemHistoryByGroupKey,
};
