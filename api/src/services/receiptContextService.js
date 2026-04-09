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

function buildAliasSummary(rows = []) {
  return rows
    .filter(Boolean)
    .map((row) => {
      const rawLabel = `${row.raw_label || ''}`.trim();
      const canonicalName = `${row.canonical_name || ''}`.trim();
      if (!rawLabel || !canonicalName) return null;
      const pieces = [`"${rawLabel}" usually means "${canonicalName}"`];
      if (row.merchant) pieces.push(`at ${row.merchant}`);
      if (row.occurrence_count) pieces.push(`${row.occurrence_count}x`);
      return pieces.join(' · ');
    })
    .filter(Boolean);
}

async function listMerchantAliasPriors(householdId, merchantHint, limit = 6) {
  if (!householdId || !merchantHint) return [];
  const explicitResult = await db.query(
    `SELECT
       raw_label,
       corrected_label AS canonical_name,
       merchant,
       occurrence_count,
       updated_at AS last_seen_at
     FROM receipt_line_corrections
     WHERE household_id = $1
       AND LOWER(merchant) = LOWER($2)
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $3`,
    [householdId, merchantHint, limit]
  );
  const explicitAliases = buildAliasSummary(explicitResult.rows);
  if (explicitAliases.length >= limit) return explicitAliases.slice(0, limit);

  const result = await db.query(
    `SELECT
       ei.description AS raw_label,
       p.name AS canonical_name,
       e.merchant,
       COUNT(*)::int AS occurrence_count,
       MAX(e.date) AS last_seen_at
     FROM expense_items ei
     JOIN expenses e ON e.id = ei.expense_id
     JOIN products p ON p.id = ei.product_id
     WHERE e.household_id = $1
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND LOWER(e.merchant) = LOWER($2)
       AND LOWER(TRIM(COALESCE(ei.description, ''))) <> LOWER(TRIM(COALESCE(p.name, '')))
     GROUP BY ei.description, p.name, e.merchant
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $3`,
    [householdId, merchantHint, Math.max(limit - explicitAliases.length, 1)]
  );
  const inferredAliases = buildAliasSummary(result.rows);
  return [...explicitAliases, ...inferredAliases.filter((item) => !explicitAliases.includes(item))].slice(0, limit);
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
  const merchantAliases = await listMerchantAliasPriors(householdId, merchantHint, 6);
  const merchantItems = await listRecentMerchantItemPriors(householdId, merchantHint, 8);
  const stapleItems = await listHouseholdStaplePriors(householdId, merchantItems.length ? 6 : 10);
  const combined = [
    ...merchantAliases,
    ...merchantItems.filter((item) => !merchantAliases.includes(item)),
    ...stapleItems.filter((item) => !merchantAliases.includes(item) && !merchantItems.includes(item)),
  ].slice(0, 12);
  return {
    merchant_hint: merchantHint || null,
    merchant_alias_count: merchantAliases.length,
    merchant_item_count: merchantItems.length,
    staple_item_count: stapleItems.length,
    prior_count: combined.length,
    priors: combined,
  };
}

module.exports = {
  buildReceiptParsingContext,
};
