const db = require('../db');
const { householdExpenseVisibilitySql } = require('./expenseAccessPolicy');
const {
  cleanItemDescription,
  isInsightEligibleItemIdentity,
  normalizeItemDisplayName,
} = require('./itemNormalizer');
const { cleanMerchantDisplayName } = require('./merchantIdentity');

function formatCurrency(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : null;
}

function buildPriorSummary(rows = []) {
  return rows
    .filter(Boolean)
    .filter((row) => isInsightEligibleItemIdentity({ item_name: row.item_name || row.description }))
    .map((row) => {
      const pieces = [normalizeItemDisplayName(cleanItemDescription(row.item_name || row.description)) || 'Unknown item'];
      const merchant = cleanMerchantDisplayName(row.merchant);
      if (merchant) pieces.push(`at ${merchant}`);
      if (row.occurrence_count) pieces.push(`${row.occurrence_count}x`);
      const amount = formatCurrency(row.last_amount || row.median_amount);
      if (amount) pieces.push(amount);
      return pieces.join(' · ');
    });
}

function buildAliasSummary(rows = []) {
  return rows
    .filter(Boolean)
    .filter((row) => isInsightEligibleItemIdentity({
      description: row.raw_label,
      item_name: row.canonical_name,
    }))
    .map((row) => {
      const rawLabel = `${row.raw_label || ''}`.trim();
      const canonicalName = normalizeItemDisplayName(`${row.canonical_name || ''}`.trim());
      if (!rawLabel || !canonicalName) return null;
      const pieces = [`"${rawLabel}" usually means "${canonicalName}"`];
      if (row.merchant) pieces.push(`at ${row.merchant}`);
      if (row.occurrence_count) pieces.push(`${row.occurrence_count}x`);
      return pieces.join(' · ');
    })
    .filter(Boolean);
}

async function listMerchantAliasPriors(householdId, requesterUserId, merchantHint, limit = 6) {
  if (!householdId || !merchantHint) return [];
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
       AND ${householdExpenseVisibilitySql(4)}
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND COALESCE(ei.extraction_confidence, 'medium') <> 'low'
       AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
       AND LOWER(COALESCE(ei.description, '')) NOT LIKE '%redacted%'
       AND LOWER(COALESCE(p.name, '')) NOT LIKE '%redacted%'
       AND REGEXP_REPLACE(LOWER(e.merchant), '[^a-z0-9]+', '', 'g') =
           REGEXP_REPLACE(LOWER($2), '[^a-z0-9]+', '', 'g')
       AND LOWER(TRIM(COALESCE(ei.description, ''))) <> LOWER(TRIM(COALESCE(p.name, '')))
     GROUP BY ei.description, p.name, e.merchant
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $3`,
    [householdId, merchantHint, limit, requesterUserId]
  );
  return buildAliasSummary(result.rows).slice(0, limit);
}

async function listRecentMerchantItemPriors(householdId, requesterUserId, merchantHint, limit = 8) {
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
       AND ${householdExpenseVisibilitySql(4)}
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND COALESCE(ei.extraction_confidence, 'medium') <> 'low'
       AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
       AND LOWER(COALESCE(ei.description, '')) NOT LIKE '%redacted%'
       AND LOWER(COALESCE(p.name, '')) NOT LIKE '%redacted%'
       AND REGEXP_REPLACE(LOWER(e.merchant), '[^a-z0-9]+', '', 'g') =
           REGEXP_REPLACE(LOWER($2), '[^a-z0-9]+', '', 'g')
     GROUP BY COALESCE(p.name, ei.description), e.merchant
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $3`,
    [householdId, merchantHint, limit, requesterUserId]
  );
  return buildPriorSummary(result.rows);
}

async function listHouseholdStaplePriors(householdId, requesterUserId, limit = 8) {
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
       AND ${householdExpenseVisibilitySql(3)}
       AND e.status = 'confirmed'
       AND e.date >= CURRENT_DATE - INTERVAL '180 days'
       AND COALESCE(ei.item_type, 'product') = 'product'
       AND COALESCE(ei.extraction_confidence, 'medium') <> 'low'
       AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
       AND LOWER(COALESCE(ei.description, '')) NOT LIKE '%redacted%'
       AND LOWER(COALESCE(p.name, '')) NOT LIKE '%redacted%'
       AND (ei.product_id IS NOT NULL OR ei.comparable_key IS NOT NULL)
     GROUP BY COALESCE(p.name, ei.description)
     HAVING COUNT(*) >= 2
     ORDER BY occurrence_count DESC, last_seen_at DESC
     LIMIT $2`,
    [householdId, limit, requesterUserId]
  );
  return buildPriorSummary(result.rows);
}

async function buildReceiptParsingContext({ householdId, requesterUserId = null, merchantHint = null } = {}) {
  const merchantAliases = await listMerchantAliasPriors(householdId, requesterUserId, merchantHint, 6);
  const merchantItems = await listRecentMerchantItemPriors(householdId, requesterUserId, merchantHint, 8);
  const stapleItems = await listHouseholdStaplePriors(householdId, requesterUserId, merchantItems.length ? 6 : 10);
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
