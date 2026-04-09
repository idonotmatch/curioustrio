const db = require('../db');

function formatCurrency(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : null;
}

function buildPriorSummary(rows = []) {
  return rows
    .filter(Boolean)
    .map((row) => {
      const pieces = [row.item_name || row.description || 'Unknown item'];
      if (row.merchant) pieces.push(`at ${row.merchant}`);
      if (row.occurrence_count) pieces.push(`${row.occurrence_count}x`);
      const amount = formatCurrency(row.last_amount || row.median_amount);
      if (amount) pieces.push(amount);
      return pieces.join(' · ');
    });
}

async function listRecentMerchantItemPriors(householdId, merchantHint, limit = 8) {
  if (!householdId || !merchantHint) return [];
  const result = await db.query(
    `SELECT
       COALESCE(p.name, ei.description) AS item_name,
       e.merchant,
       COUNT(*)::int AS occurrence_count,
       MAX(e.date) AS last_seen_at,
       MAX(ei.amount) FILTER (WHERE ei.amount IS NOT NULL) AS last_amount
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     LEFT JOIN products p ON p.id = ei.product_id
     WHERE e.household_id = $1
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND LOWER(e.merchant) = LOWER($2)
     GROUP BY COALESCE(p.name, ei.description), e.merchant
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $3`,
    [householdId, merchantHint, limit]
  );
  return buildPriorSummary(result.rows);
}

async function listHouseholdStaplePriors(householdId, limit = 8) {
  if (!householdId) return [];
  const result = await db.query(
    `SELECT
       COALESCE(p.name, ei.description) AS item_name,
       MAX(e.merchant) AS merchant,
       COUNT(*)::int AS occurrence_count,
       MAX(e.date) AS last_seen_at,
       MAX(ei.amount) FILTER (WHERE ei.amount IS NOT NULL) AS last_amount
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     LEFT JOIN products p ON p.id = ei.product_id
     WHERE e.household_id = $1
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
     GROUP BY COALESCE(p.name, ei.description)
     HAVING COUNT(*) >= 2
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $2`,
    [householdId, limit]
  );
  return buildPriorSummary(result.rows);
}

async function buildReceiptParsingContext({ householdId, merchantHint = null } = {}) {
  const merchantItems = await listRecentMerchantItemPriors(householdId, merchantHint, 8);
  const stapleItems = await listHouseholdStaplePriors(householdId, merchantItems.length ? 6 : 10);
  const combined = [...merchantItems, ...stapleItems.filter((item) => !merchantItems.includes(item))].slice(0, 12);
  return {
    merchant_hint: merchantHint || null,
    prior_count: combined.length,
    priors: combined,
  };
}

module.exports = {
  buildReceiptParsingContext,
};
