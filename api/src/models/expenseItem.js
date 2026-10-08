const crypto = require('crypto');
const db = require('../db');
const { normalizeItemMetadata } = require('../services/itemNormalizer');
const { classifyExpenseItemType } = require('../services/itemClassifier');

function safeNumeric(value, max, { positive = false } = {}) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > max) return null;
  if (positive && numeric <= 0) return null;
  return numeric;
}

function hydrateItem(item = {}, index = 0) {
  const normalized = normalizeItemMetadata(item);
  const hydrated = {
    ...item,
    description: normalized.cleaned_description || item.description,
    product_size: item.product_size || normalized.inferred_product_size || null,
    pack_size: item.pack_size || normalized.inferred_pack_size || null,
    unit: item.unit || normalized.inferred_unit || null,
    sort_order: item.sort_order ?? index,
    item_type: item.item_type || classifyExpenseItemType(item.description),
    product_match_confidence: item.product_match_confidence || null,
    product_match_reason: item.product_match_reason || null,
    observation_key: item.observation_key || crypto.randomUUID(),
    source_type: item.source_type || null,
    raw_description: item.raw_description || item.description || null,
    extraction_confidence: item.extraction_confidence || null,
    ...normalized,
  };
  return {
    ...hydrated,
    amount: safeNumeric(hydrated.amount, 99_999_999.99),
    quantity: safeNumeric(hydrated.quantity, 9_999_999.999, { positive: true }),
    unit_price: safeNumeric(hydrated.unit_price, 999_999.9999, { positive: true }),
    normalized_size_value: safeNumeric(hydrated.normalized_size_value, 9_999_999.999, { positive: true }),
    normalized_pack_size: safeNumeric(hydrated.normalized_pack_size, 9_999_999.999, { positive: true }),
    normalized_quantity: safeNumeric(hydrated.normalized_quantity, 9_999_999.999, { positive: true }),
    normalized_total_size_value: safeNumeric(hydrated.normalized_total_size_value, 9_999_999.999, { positive: true }),
    estimated_unit_price: safeNumeric(hydrated.estimated_unit_price, 999_999.9999, { positive: true }),
  };
}

async function createBulk(expenseId, items, queryable = db) {
  if (!items || items.length === 0) return [];
  const preparedItems = items.map((item, i) => hydrateItem(item, i));
  const values = preparedItems.map((_, i) => {
      const offset = i * 29;
      return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24}, $${offset + 25}, $${offset + 26}, $${offset + 27}, $${offset + 28}, $${offset + 29}, $${offset + 30})`;
  });
  const params = [expenseId];
  preparedItems.forEach((item) => {
    params.push(
      item.description,
      item.amount ?? null,
      item.quantity ?? null,
      item.unit_price ?? null,
      item.sort_order,
      item.item_type ?? 'product',
      item.product_id ?? null,
      item.upc ?? null,
      item.sku ?? null,
      item.brand ?? null,
      item.product_size ?? null,
      item.pack_size ?? null,
      item.unit ?? null,
      item.normalized_name ?? null,
      item.normalized_brand ?? null,
      item.normalized_size_value ?? null,
      item.normalized_size_unit ?? null,
      item.normalized_pack_size ?? null,
      item.normalized_quantity ?? null,
      item.normalized_total_size_value ?? null,
      item.normalized_total_size_unit ?? null,
      item.estimated_unit_price ?? null,
      item.comparable_key ?? null,
      item.product_match_confidence ?? null,
      item.product_match_reason ?? null,
      item.observation_key ?? null,
      item.source_type ?? null,
      item.raw_description ?? null,
      item.extraction_confidence ?? null,
    );
  });
  const result = await queryable.query(
    `INSERT INTO expense_items (
       expense_id, description, amount, quantity, unit_price, sort_order, item_type, product_id, upc, sku, brand, product_size, pack_size, unit,
       normalized_name, normalized_brand, normalized_size_value, normalized_size_unit, normalized_pack_size,
       normalized_quantity, normalized_total_size_value, normalized_total_size_unit, estimated_unit_price, comparable_key,
       product_match_confidence, product_match_reason,
       observation_key, source_type, raw_description, extraction_confidence
     )
     VALUES ${values.join(', ')}
     RETURNING *`,
    params
  );
  return result.rows;
}

async function findByExpenseId(expenseId) {
  const result = await db.query(
    `SELECT i.*,
            p.name AS candidate_product_name,
            p.brand AS candidate_product_brand,
            p.merchant AS candidate_product_merchant
     FROM expense_items i
     LEFT JOIN products p ON p.id = i.product_id
     WHERE i.expense_id = $1
     ORDER BY i.sort_order ASC`,
    [expenseId]
  );
  return result.rows;
}

async function findByIdForExpense(id, expenseId, queryable = db) {
  const result = await queryable.query(
    `SELECT * FROM expense_items WHERE id = $1 AND expense_id = $2 LIMIT 1`,
    [id, expenseId]
  );
  return result.rows[0] || null;
}

async function replaceItems(expenseId, items, queryable = null) {
  const ownsTransaction = !queryable;
  const client = queryable || await db.pool.connect();
  try {
    if (ownsTransaction) await client.query('BEGIN');
    await client.query('DELETE FROM expense_items WHERE expense_id = $1', [expenseId]);
    let rows = [];
    if (items && items.length > 0) {
      const preparedItems = items.map((item, i) => hydrateItem(item, i));
      const values = preparedItems.map((_, i) => {
        const offset = i * 29;
        return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24}, $${offset + 25}, $${offset + 26}, $${offset + 27}, $${offset + 28}, $${offset + 29}, $${offset + 30})`;
      });
      const params = [expenseId];
      preparedItems.forEach((item) => {
        params.push(
          item.description,
          item.amount ?? null,
          item.quantity ?? null,
          item.unit_price ?? null,
          item.sort_order,
          item.item_type ?? 'product',
          item.product_id ?? null,
          item.upc ?? null,
          item.sku ?? null,
          item.brand ?? null,
          item.product_size ?? null,
          item.pack_size ?? null,
          item.unit ?? null,
          item.normalized_name ?? null,
          item.normalized_brand ?? null,
          item.normalized_size_value ?? null,
          item.normalized_size_unit ?? null,
          item.normalized_pack_size ?? null,
          item.normalized_quantity ?? null,
          item.normalized_total_size_value ?? null,
          item.normalized_total_size_unit ?? null,
          item.estimated_unit_price ?? null,
          item.comparable_key ?? null,
          item.product_match_confidence ?? null,
          item.product_match_reason ?? null,
          item.observation_key ?? null,
          item.source_type ?? null,
          item.raw_description ?? null,
          item.extraction_confidence ?? null,
        );
      });
      const result = await client.query(
        `INSERT INTO expense_items (
           expense_id, description, amount, quantity, unit_price, sort_order, item_type, product_id, upc, sku, brand, product_size, pack_size, unit,
           normalized_name, normalized_brand, normalized_size_value, normalized_size_unit, normalized_pack_size,
           normalized_quantity, normalized_total_size_value, normalized_total_size_unit, estimated_unit_price, comparable_key,
           product_match_confidence, product_match_reason,
           observation_key, source_type, raw_description, extraction_confidence
         )
         VALUES ${values.join(', ')}
         RETURNING *`,
        params
      );
      rows = result.rows;
    }
    if (ownsTransaction) await client.query('COMMIT');
    return rows;
  } catch (err) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}

async function updateResolution(id, expenseId, {
  productId = null,
  productMatchConfidence = null,
  productMatchReason = null,
} = {}, queryable = db) {
  const result = await queryable.query(
    `UPDATE expense_items
     SET product_id = $3,
         product_match_confidence = $4,
         product_match_reason = $5
     WHERE id = $1
       AND expense_id = $2
     RETURNING *`,
    [id, expenseId, productId, productMatchConfidence, productMatchReason]
  );
  return result.rows[0] || null;
}

async function applyConfirmedAlias({
  householdId,
  normalizedName,
  merchant,
  productId,
  excludeItemId = null,
} = {}, queryable = db) {
  if (!householdId || !normalizedName || !merchant || !productId) return 0;
  const result = await queryable.query(
    `UPDATE expense_items ei
     SET product_id = $4,
         product_match_confidence = 'high',
         product_match_reason = 'household_confirmed_alias'
     FROM expenses e
     WHERE e.id = ei.expense_id
       AND e.household_id = $1
       AND ei.normalized_name = $2
       AND REGEXP_REPLACE(LOWER(COALESCE(e.merchant, '')), '[^a-z0-9]+', '', 'g') =
           REGEXP_REPLACE(LOWER($3), '[^a-z0-9]+', '', 'g')
       AND ($5::uuid IS NULL OR ei.id <> $5)
       AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
       AND (ei.product_id IS NULL OR ei.product_match_confidence = 'medium')
     RETURNING ei.id`,
    [householdId, normalizedName, merchant, productId, excludeItemId]
  );
  return result.rows.length;
}

module.exports = {
  createBulk,
  findByExpenseId,
  findByIdForExpense,
  replaceItems,
  updateResolution,
  applyConfirmedAlias,
};
