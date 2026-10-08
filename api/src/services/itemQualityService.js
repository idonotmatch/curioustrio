const db = require('../db');
const { householdExpenseVisibilitySql } = require('./expenseAccessPolicy');

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(3)) : 0;
}

async function getItemQualitySummary(user, { days = 180 } = {}) {
  const lookbackDays = Math.max(1, Math.min(Number(days) || 180, 365));
  const householdScope = Boolean(user?.household_id);
  const ownerId = householdScope ? user.household_id : user.id;
  const visibility = householdScope ? `AND ${householdExpenseVisibilitySql(3)}` : '';
  const result = await db.query(
    `WITH eligible AS (
       SELECT ei.*, e.merchant, e.date
       FROM expense_items ei
       JOIN expenses e ON e.id = ei.expense_id
       WHERE ${householdScope ? 'e.household_id = $1' : 'e.user_id = $1'}
         ${visibility}
         AND e.status = 'confirmed'
         AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
         AND COALESCE(ei.item_type, 'product') = 'product'
     ), identity_groups AS (
       SELECT CASE
         WHEN product_id IS NOT NULL THEN 'product:' || product_id::text
         WHEN comparable_key IS NOT NULL THEN 'comparable:' || comparable_key
       END AS group_key,
       COUNT(*)::int AS occurrences,
       COUNT(DISTINCT REGEXP_REPLACE(LOWER(merchant), '[^a-z0-9]+', '', 'g'))::int AS merchant_count
       FROM eligible
       WHERE product_id IS NOT NULL OR comparable_key IS NOT NULL
       GROUP BY 1
     )
     SELECT
       (SELECT COUNT(*)::int FROM eligible) AS total_items,
       (SELECT COUNT(*)::int FROM eligible WHERE product_id IS NOT NULL) AS canonical_items,
       (SELECT COUNT(*)::int FROM eligible WHERE product_id IS NOT NULL OR comparable_key IS NOT NULL) AS history_eligible_items,
       (SELECT COUNT(*)::int FROM eligible WHERE estimated_unit_price IS NOT NULL) AS comparable_price_items,
       (SELECT COUNT(*)::int FROM eligible WHERE quantity IS NOT NULL) AS quantity_items,
       (SELECT COUNT(*)::int FROM eligible WHERE normalized_size_value IS NOT NULL) AS structured_size_items,
       (SELECT COUNT(*)::int FROM eligible WHERE extraction_confidence = 'low') AS low_confidence_items,
       (SELECT COUNT(*)::int FROM identity_groups WHERE occurrences >= 2) AS repeated_groups,
       (SELECT COUNT(*)::int FROM identity_groups WHERE occurrences >= 3) AS insight_ready_groups,
       (SELECT COUNT(*)::int FROM identity_groups WHERE occurrences >= 2 AND merchant_count >= 2) AS cross_merchant_groups`,
    householdScope
      ? [ownerId, lookbackDays, user.id]
      : [ownerId, lookbackDays]
  );
  const row = result.rows[0] || {};
  const totalItems = Number(row.total_items || 0);
  const counts = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
  return {
    lookback_days: lookbackDays,
    counts,
    coverage: {
      canonical_identity: ratio(counts.canonical_items, totalItems),
      history_eligible: ratio(counts.history_eligible_items, totalItems),
      comparable_price: ratio(counts.comparable_price_items, totalItems),
      quantity: ratio(counts.quantity_items, totalItems),
      structured_size: ratio(counts.structured_size_items, totalItems),
      low_confidence: ratio(counts.low_confidence_items, totalItems),
    },
  };
}

module.exports = { getItemQualitySummary };
