const db = require('../db');
const ItemFamilyComparisonDecision = require('../models/itemFamilyComparisonDecision');
const { householdExpenseVisibilitySql } = require('./expenseAccessPolicy');
const {
  cleanItemDescription,
  isInsightEligibleItemIdentity,
  normalizeItemDisplayName,
} = require('./itemNormalizer');
const { cleanMerchantDisplayName, canonicalMerchantKey } = require('./merchantIdentity');
const {
  automaticItemInsightDecision,
  classifyItemInsightContext,
  insightEligibilityMetadata,
} = require('./itemInsightEligibility');
const { enrichWithItemFamily, normalizeVariantPair } = require('./itemFamilyService');

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

function buildGroupKey(row = {}, { groupByFamily = false } = {}) {
  if (groupByFamily && (row.item_family_key || row.family_key)) {
    return `family:${row.item_family_key || row.family_key}`;
  }
  if (row.product_id) return `product:${row.product_id}`;
  if (row.comparable_key) return `comparable:${row.comparable_key}`;
  return null;
}

function summarizeHistoryRows(rows = [], { groupByFamily = false, comparisonDecisions = [] } = {}) {
  const grouped = new Map();

  for (const row of rows) {
    if (row?.product_match_reason === 'user_rejected_match') continue;
    if (!isInsightEligibleItemIdentity({
      item_name: row?.item_name || row?.description,
      comparable_key: row?.comparable_key,
    })) continue;
    const enriched = groupByFamily ? enrichWithItemFamily(row) : row;
    const groupKey = buildGroupKey(enriched, { groupByFamily });
    if (!groupKey) continue;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push({
      expense_item_id: enriched.expense_item_id || null,
      expense_id: enriched.expense_id || null,
      group_key: groupKey,
      product_id: enriched.product_id || null,
      comparable_key: enriched.comparable_key || null,
      item_family_key: enriched.family_key || null,
      item_family_name: enriched.family_name || null,
      price_variant_key: enriched.price_variant_key || null,
      price_variant_label: enriched.price_variant_label || null,
      price_comparison_confidence: enriched.price_comparison_confidence || null,
      product_match_confidence: enriched.product_match_confidence || null,
      product_match_reason: enriched.product_match_reason || null,
      extraction_confidence: enriched.extraction_confidence || null,
      source_type: enriched.source_type || null,
      expense_category_name: enriched.expense_category_name || null,
      parent_category_name: enriched.parent_category_name || null,
      category_group_name: enriched.category_group_name || null,
      item_name: normalizeItemDisplayName(cleanItemDescription(enriched.item_name || enriched.description)) || null,
      brand: enriched.brand || null,
      merchant: cleanMerchantDisplayName(enriched.merchant) || null,
      amount: enriched.item_amount == null ? null : Number(enriched.item_amount),
      estimated_unit_price: enriched.estimated_unit_price == null ? null : Number(enriched.estimated_unit_price),
      normalized_total_size_value: enriched.normalized_total_size_value == null ? null : Number(enriched.normalized_total_size_value),
      normalized_total_size_unit: enriched.normalized_total_size_unit || null,
      date: toDateOnly(enriched.date),
    });
  }

  return [...grouped.values()].map((entries) => summarizeIdentity(entries, { comparisonDecisions }))
    .filter(Boolean)
    .sort((a, b) => (
      b.occurrence_count - a.occurrence_count
      || `${b.last_purchased_at}`.localeCompare(`${a.last_purchased_at}`)
      || `${a.item_name || ''}`.localeCompare(`${b.item_name || ''}`)
    ));
}

function summarizePriceVariants(entries = []) {
  const variants = new Map();
  entries.forEach((entry) => {
    const key = entry.price_variant_key || entry.group_key;
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(entry);
  });
  return [...variants.entries()].map(([variantKey, variantEntries]) => {
    const sorted = [...variantEntries].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const merchants = [...new Map(sorted.map((entry) => [
      canonicalMerchantKey(entry.merchant),
      cleanMerchantDisplayName(entry.merchant),
    ])).values()].filter(Boolean);
    return {
      variant_key: variantKey,
      label: latest.price_variant_label || latest.item_name || 'Matched variant',
      item_name: latest.item_name || null,
      occurrence_count: sorted.length,
      merchants,
      merchant_count: merchants.length,
      last_purchased_at: latest.date,
      median_amount: median(sorted.map((entry) => entry.amount).filter((value) => value != null)),
      normalized_total_size_value: latest.normalized_total_size_value,
      normalized_total_size_unit: latest.normalized_total_size_unit,
      price_comparison_confidence: latest.price_comparison_confidence || 'unknown_package',
    };
  }).sort((a, b) => (
    b.occurrence_count - a.occurrence_count
    || `${b.last_purchased_at}`.localeCompare(`${a.last_purchased_at}`)
  ));
}

function buildFamilyComparison(entries = [], decisions = []) {
  const variants = summarizePriceVariants(entries);
  if (!entries[0]?.item_family_key || variants.length <= 1) {
    return {
      variants,
      comparisonEntries: entries,
      comparisonStatus: variants.length === 1 ? 'single_variant' : 'not_applicable',
      comparisonReviews: [],
    };
  }

  const keys = new Set(variants.map((variant) => variant.variant_key));
  const adjacency = new Map([...keys].map((key) => [key, new Set([key])]));
  const decisionsByPair = new Map();
  decisions.forEach((decision) => {
    const [left, right] = normalizeVariantPair(decision.left_variant_key, decision.right_variant_key);
    if (!keys.has(left) || !keys.has(right)) return;
    decisionsByPair.set(`${left}\n${right}`, decision.decision);
    if (decision.decision === 'comparable') {
      adjacency.get(left).add(right);
      adjacency.get(right).add(left);
    }
  });

  const latestEntry = [...entries].sort((a, b) => a.date.localeCompare(b.date))[entries.length - 1];
  const latestVariantKey = latestEntry.price_variant_key || latestEntry.group_key;
  const comparableKeys = new Set([latestVariantKey]);
  const pending = [latestVariantKey];
  while (pending.length) {
    const current = pending.shift();
    (adjacency.get(current) || []).forEach((key) => {
      if (comparableKeys.has(key)) return;
      comparableKeys.add(key);
      pending.push(key);
    });
  }
  const comparisonEntries = entries.filter((entry) => comparableKeys.has(entry.price_variant_key || entry.group_key));

  const comparisonReviews = [];
  for (let leftIndex = 0; leftIndex < variants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variants.length; rightIndex += 1) {
      const left = variants[leftIndex];
      const right = variants[rightIndex];
      if (comparableKeys.has(left.variant_key) === comparableKeys.has(right.variant_key)) continue;
      if (
        left.price_comparison_confidence === 'high'
        && right.price_comparison_confidence === 'high'
      ) continue;
      const leftMerchants = new Set(left.merchants.map(canonicalMerchantKey).filter(Boolean));
      const rightMerchants = new Set(right.merchants.map(canonicalMerchantKey).filter(Boolean));
      const merchantKeys = new Set([...leftMerchants, ...rightMerchants]);
      if (merchantKeys.size <= 1) continue;
      const [leftKey, rightKey] = normalizeVariantPair(left.variant_key, right.variant_key);
      if (decisionsByPair.has(`${leftKey}\n${rightKey}`)) continue;
      comparisonReviews.push({
        left_variant_key: left.variant_key,
        right_variant_key: right.variant_key,
        left,
        right,
      });
    }
  }

  return {
    variants,
    comparisonEntries,
    comparisonStatus: comparisonReviews.length
      ? 'needs_review'
      : (comparableKeys.size > 1 ? 'confirmed_comparable' : 'distinct_variants'),
    comparisonReviews: comparisonReviews.slice(0, 3),
  };
}

function summarizeIdentity(entries = [], { comparisonDecisions = [] } = {}) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const first = sorted[0];
  const familyComparison = buildFamilyComparison(sorted, comparisonDecisions);
  const comparisonSorted = [...familyComparison.comparisonEntries].sort((a, b) => a.date.localeCompare(b.date));
  const comparisonLatest = comparisonSorted[comparisonSorted.length - 1] || latest;
  const amounts = comparisonSorted.map((entry) => entry.amount).filter((value) => value != null);
  const basisCounts = new Map();
  comparisonSorted.forEach((entry) => {
    if (entry.estimated_unit_price == null || !entry.normalized_total_size_unit) return;
    basisCounts.set(entry.normalized_total_size_unit, (basisCounts.get(entry.normalized_total_size_unit) || 0) + 1);
  });
  const priceBasisUnit = [...basisCounts.entries()]
    .sort((a, b) => (
      b[1] - a[1]
      || Number(comparisonLatest.normalized_total_size_unit === b[0])
      - Number(comparisonLatest.normalized_total_size_unit === a[0])
    ))[0]?.[0] || null;
  const comparableUnitPrice = (entry) => (
    priceBasisUnit && entry.normalized_total_size_unit === priceBasisUnit
      ? entry.estimated_unit_price
      : null
  );
  const unitPrices = comparisonSorted.map(comparableUnitPrice).filter((value) => value != null);
  const priorAmounts = comparisonSorted.slice(0, -1).map((entry) => entry.amount).filter((value) => value != null);
  const priorUnitPrices = comparisonSorted.slice(0, -1).map(comparableUnitPrice).filter((value) => value != null);
  const merchantMap = new Map();
  sorted.forEach((entry) => {
    const merchant = cleanMerchantDisplayName(entry.merchant);
    const key = canonicalMerchantKey(merchant);
    if (key && merchant) merchantMap.set(key, merchant);
  });
  const merchants = [...merchantMap.values()];
  const comparisonMerchantMap = new Map();
  comparisonSorted.forEach((entry) => {
    const merchant = cleanMerchantDisplayName(entry.merchant);
    const key = canonicalMerchantKey(merchant);
    if (key && merchant) comparisonMerchantMap.set(key, merchant);
  });
  const sourceTypes = [...new Set(sorted.map((entry) => `${entry.source_type || ''}`.trim()).filter(Boolean))]
    .sort();
  const sourceBreakdown = sourceTypes.map((sourceType) => ({
    source_type: sourceType,
    occurrence_count: sorted.filter((entry) => entry.source_type === sourceType).length,
  }));
  const dateObjs = sorted.map((entry) => parseDateOnly(entry.date));
  const gaps = [];
  for (let i = 1; i < dateObjs.length; i += 1) {
    gaps.push(Math.round((dateObjs[i] - dateObjs[i - 1]) / (1000 * 60 * 60 * 24)));
  }
  const merchantBreakdown = [...comparisonMerchantMap.entries()].map(([merchantKey, merchant]) => {
    const merchantEntries = comparisonSorted.filter((entry) => canonicalMerchantKey(entry.merchant) === merchantKey);
    const merchantAmounts = merchantEntries.map((entry) => entry.amount).filter((value) => value != null);
    const merchantUnitPrices = merchantEntries.map(comparableUnitPrice).filter((value) => value != null);
    return {
      merchant,
      occurrence_count: merchantEntries.length,
      amount_observation_count: merchantAmounts.length,
      unit_price_observation_count: merchantUnitPrices.length,
      median_amount: median(merchantAmounts),
      median_unit_price: median(merchantUnitPrices),
      price_basis_unit: merchantUnitPrices.length ? priceBasisUnit : null,
      last_purchased_at: merchantEntries[merchantEntries.length - 1]?.date || null,
    };
  }).sort((a, b) => b.occurrence_count - a.occurrence_count || a.merchant.localeCompare(b.merchant));
  const strongIdentityCount = sorted.filter((entry) => (
    entry.product_id
    && (
      entry.product_match_confidence === 'high'
      || entry.product_match_reason === 'user_confirmed'
      || entry.product_match_reason === 'exact_upc'
    )
  )).length;
  const identityConfidence = latest.item_family_key
    ? (familyComparison.variants.every((variant) => variant.price_comparison_confidence === 'high') ? 'high' : 'medium')
    : latest.product_id
    ? (strongIdentityCount >= Math.min(2, sorted.length) ? 'high' : 'medium')
    : (sorted.every((entry) => entry.product_match_confidence === 'high') ? 'high' : 'medium');
  const nextExpected = gaps.length ? new Date(`${latest.date}T12:00:00`) : null;
  if (nextExpected) nextExpected.setDate(nextExpected.getDate() + median(gaps));
  const insightEligibility = automaticItemInsightDecision(sorted, { minOccurrences: 3 });

  return {
    kind: latest.item_family_key ? 'item_family_history' : 'item_history',
    group_key: latest.group_key,
    product_id: latest.product_id,
    comparable_key: latest.comparable_key,
    item_family_key: latest.item_family_key,
    item_family_name: latest.item_family_name,
    identity_confidence: identityConfidence,
    strong_identity_count: strongIdentityCount,
    item_name: latest.item_family_name || latest.item_name,
    brand: latest.item_family_key ? null : latest.brand,
    occurrence_count: sorted.length,
    average_gap_days: gaps.length ? median(gaps) : null,
    median_amount: median(amounts),
    median_unit_price: median(unitPrices),
    price_basis_unit: priceBasisUnit,
    prior_median_amount: median(priorAmounts),
    prior_median_unit_price: median(priorUnitPrices),
    baseline_purchase_count: Math.max(0, comparisonSorted.length - 1),
    price_comparable_purchase_count: comparisonSorted.length,
    price_variant_count: familyComparison.variants.length,
    price_variants: familyComparison.variants,
    price_comparison_status: familyComparison.comparisonStatus,
    comparison_reviews: familyComparison.comparisonReviews,
    first_purchased_at: first.date,
    last_purchased_at: latest.date,
    next_expected_date: nextExpected ? nextExpected.toISOString().slice(0, 10) : null,
    merchants,
    source_types: sourceTypes,
    source_breakdown: sourceBreakdown,
    cross_source_identity: sourceTypes.length > 1,
    merchant_breakdown: merchantBreakdown,
    merchant_price_history: merchantBreakdown,
    normalized_total_size_value: comparisonLatest.normalized_total_size_value,
    normalized_total_size_unit: priceBasisUnit || comparisonLatest.normalized_total_size_unit,
    insight_eligibility: insightEligibilityMetadata(insightEligibility),
    purchases: sorted.map((entry) => ({
      expense_item_id: entry.expense_item_id,
      id: entry.expense_id || null,
      date: entry.date,
      merchant: entry.merchant,
      amount: entry.amount,
      item_amount: entry.amount,
      estimated_unit_price: entry.estimated_unit_price,
      normalized_total_size_value: entry.normalized_total_size_value,
      normalized_total_size_unit: entry.normalized_total_size_unit,
      product_match_confidence: entry.product_match_confidence,
      product_match_reason: entry.product_match_reason,
      extraction_confidence: entry.extraction_confidence,
      source_type: entry.source_type,
      price_variant_key: entry.price_variant_key,
      price_variant_label: entry.price_variant_label,
      price_comparison_confidence: entry.price_comparison_confidence,
    })),
    comparison_purchases: comparisonSorted.map((entry) => ({
      expense_item_id: entry.expense_item_id,
      id: entry.expense_id || null,
      date: entry.date,
      merchant: entry.merchant,
      amount: entry.amount,
      item_amount: entry.amount,
      estimated_unit_price: entry.estimated_unit_price,
      normalized_total_size_value: entry.normalized_total_size_value,
      normalized_total_size_unit: entry.normalized_total_size_unit,
      price_variant_key: entry.price_variant_key,
      price_variant_label: entry.price_variant_label,
    })),
  };
}

function compactItemHistorySummary(history = {}) {
  const purchases = Array.isArray(history.comparison_purchases)
    ? history.comparison_purchases
    : (Array.isArray(history.purchases) ? history.purchases : []);
  const latestPurchase = purchases[purchases.length - 1] || null;
  const latestUsesUnitPrice = Boolean(
    history.price_basis_unit
    && latestPurchase?.normalized_total_size_unit === history.price_basis_unit
    && latestPurchase?.estimated_unit_price != null
  );
  const latestPrice = latestUsesUnitPrice
    ? Number(latestPurchase.estimated_unit_price)
    : latestPurchase?.item_amount == null
      ? null
      : Number(latestPurchase.item_amount);
  const priorPrice = latestUsesUnitPrice
    ? history.prior_median_unit_price
    : history.prior_median_amount;
  const normalizedPriorPrice = priorPrice == null ? null : Number(priorPrice);
  const priceChangeAmount = latestPrice != null && normalizedPriorPrice != null
    ? Number((latestPrice - normalizedPriorPrice).toFixed(4))
    : null;
  const priceChangePercent = priceChangeAmount != null && normalizedPriorPrice > 0
    ? Number(((priceChangeAmount / normalizedPriorPrice) * 100).toFixed(1))
    : null;

  return {
    kind: 'item_history_summary',
    group_key: history.group_key || null,
    item_name: history.item_name || null,
    brand: history.brand || null,
    identity_confidence: history.identity_confidence || null,
    occurrence_count: Number(history.occurrence_count || 0),
    last_purchased_at: history.last_purchased_at || null,
    latest_merchant: latestPurchase?.merchant || history.merchants?.[0] || null,
    merchant_count: Array.isArray(history.merchants) ? history.merchants.length : 0,
    price_variant_count: Number(history.price_variant_count || 0),
    price_comparable_purchase_count: Number(history.price_comparable_purchase_count || purchases.length),
    price_comparison_status: history.price_comparison_status || null,
    latest_price: latestPrice,
    prior_price: normalizedPriorPrice,
    price_change_amount: priceChangeAmount,
    price_change_percent: priceChangePercent,
    price_kind: latestUsesUnitPrice ? 'unit' : 'item',
    price_basis_unit: latestUsesUnitPrice ? history.price_basis_unit : null,
    cross_source_identity: history.cross_source_identity === true,
  };
}

async function loadItemHistoryRows(ownerId, {
  scope = 'household',
  lookbackDays = 180,
  groupKey = null,
  requesterUserId = null,
} = {}) {
  const values = [ownerId, Math.max(1, Math.min(Number(lookbackDays) || 180, 365))];
  let identityClause = '';
  let visibilityClause = '';

  if (scope === 'household') {
    values.push(requesterUserId);
    visibilityClause = `AND ${householdExpenseVisibilitySql(values.length)}`;
  }

  if (groupKey) {
    if (`${groupKey}`.startsWith('product:')) {
      values.push(groupKey.slice('product:'.length));
      identityClause = `AND ei.product_id = $${values.length}`;
    } else if (`${groupKey}`.startsWith('comparable:')) {
      values.push(groupKey.slice('comparable:'.length));
      identityClause = `AND ei.comparable_key = $${values.length}`;
    } else if (!`${groupKey}`.startsWith('family:')) {
      return [];
    }
  }

  const sharedSelect = `
    SELECT
      ei.id AS expense_item_id,
      ei.expense_id,
      ei.product_id,
      ei.comparable_key,
      ei.product_match_confidence,
      ei.product_match_reason,
      ei.extraction_confidence,
      ei.description,
      ei.raw_description,
      ei.product_size,
      ei.pack_size,
      ei.unit,
      COALESCE(ei.source_type, e.source) AS source_type,
      COALESCE(p.name, ei.description) AS item_name,
      COALESCE(p.brand, ei.brand) AS brand,
      ei.amount AS item_amount,
      ei.estimated_unit_price,
      ei.normalized_total_size_value,
      ei.normalized_total_size_unit,
      e.merchant,
      e.date,
      c.name AS expense_category_name,
      pc.name AS parent_category_name,
      COALESCE(pc.name, c.name) AS category_group_name
    FROM expense_items ei
    JOIN expenses e ON e.id = ei.expense_id
    LEFT JOIN products p ON p.id = ei.product_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE ${expenseScopeClause(scope, 1)}
      ${visibilityClause}
      AND e.status = 'confirmed'
      AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      AND COALESCE(ei.item_type, 'product') = 'product'
      AND COALESCE(ei.extraction_confidence, 'medium') <> 'low'
      AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
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
  requesterUserId = null,
  automaticInsightsOnly = false,
  groupByFamily = false,
  decisionHouseholdId = null,
} = {}) {
  const [rows, comparisonDecisions] = await Promise.all([
    loadItemHistoryRows(ownerId, { scope, lookbackDays, requesterUserId }),
    groupByFamily && decisionHouseholdId
      ? ItemFamilyComparisonDecision.findByHousehold(decisionHouseholdId)
      : Promise.resolve([]),
  ]);
  const historyRows = automaticInsightsOnly
    ? rows.filter((row) => classifyItemInsightContext(row).eligible)
    : rows;
  return summarizeHistoryRows(historyRows, { groupByFamily, comparisonDecisions })
    .filter((entry) => {
      const meetsRequestedMinimum = entry.occurrence_count >= Math.max(1, Number(minOccurrences) || 2);
      return meetsRequestedMinimum && (!automaticInsightsOnly || entry.insight_eligibility?.eligible);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 2000)));
}

async function getItemHistoryByGroupKey(ownerId, groupKey, {
  scope = 'household',
  lookbackDays = 180,
  requesterUserId = null,
  decisionHouseholdId = null,
} = {}) {
  const rows = await loadItemHistoryRows(ownerId, { scope, lookbackDays, groupKey, requesterUserId });
  if (`${groupKey}`.startsWith('family:')) {
    const familyKey = `${groupKey}`.slice('family:'.length);
    const comparisonDecisions = decisionHouseholdId
      ? await ItemFamilyComparisonDecision.findByFamily(decisionHouseholdId, familyKey)
      : [];
    return summarizeHistoryRows(rows, { groupByFamily: true, comparisonDecisions })
      .find((entry) => entry.group_key === groupKey) || null;
  }
  return summarizeHistoryRows(rows)[0] || null;
}

module.exports = {
  summarizeHistoryRows,
  summarizeIdentity,
  compactItemHistorySummary,
  listItemHistorySummaries,
  getItemHistoryByGroupKey,
};
