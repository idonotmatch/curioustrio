const db = require('../db');
const { normalizeItemMetadata } = require('../services/itemNormalizer');
const { classifyExpenseItemType } = require('../services/itemClassifier');

function hydrateItem(item = {}, index = 0) {
  return {
    ...item,
    sort_order: item.sort_order ?? index,
    item_type: item.item_type || classifyExpenseItemType(item.description),
    product_match_confidence: item.product_match_confidence || null,
    product_match_reason: item.product_match_reason || null,
    ...normalizeItemMetadata(item),
  };
}

async function createBulk(expenseId, items) {
  if (!items || items.length === 0) return [];
  const preparedItems = items.map((item, i) => hydrateItem(item, i));
  const values = preparedItems.map((_, i) => {
      const offset = i * 23;
      return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24})`;
  });
  const params = [expenseId];
  preparedItems.forEach((item) => {
    params.push(
      item.description,
      item.amount ?? null,
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
    );
  });
  const result = await db.query(
    `INSERT INTO expense_items (
       expense_id, description, amount, sort_order, item_type, product_id, upc, sku, brand, product_size, pack_size, unit,
       normalized_name, normalized_brand, normalized_size_value, normalized_size_unit, normalized_pack_size,
       normalized_quantity, normalized_total_size_value, normalized_total_size_unit, estimated_unit_price, comparable_key,
       product_match_confidence, product_match_reason
     )
     VALUES ${values.join(', ')}
     RETURNING *`,
    params
  );
  return result.rows;
}

async function findByExpenseId(expenseId) {
  const result = await db.query(
    `SELECT * FROM expense_items WHERE expense_id = $1 ORDER BY sort_order ASC`,
    [expenseId]
  );
  return result.rows;
}

async function replaceItems(expenseId, items) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM expense_items WHERE expense_id = $1', [expenseId]);
    let rows = [];
    if (items && items.length > 0) {
      const preparedItems = items.map((item, i) => hydrateItem(item, i));
      const values = preparedItems.map((_, i) => {
        const offset = i * 23;
        return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24})`;
      });
      const params = [expenseId];
      preparedItems.forEach((item) => {
        params.push(
          item.description,
          item.amount ?? null,
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
        );
      });
      const result = await client.query(
        `INSERT INTO expense_items (
           expense_id, description, amount, sort_order, item_type, product_id, upc, sku, brand, product_size, pack_size, unit,
           normalized_name, normalized_brand, normalized_size_value, normalized_size_unit, normalized_pack_size,
           normalized_quantity, normalized_total_size_value, normalized_total_size_unit, estimated_unit_price, comparable_key,
           product_match_confidence, product_match_reason
         )
         VALUES ${values.join(', ')}
         RETURNING *`,
        params
      );
      rows = result.rows;
    }
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createBulk, findByExpenseId, replaceItems };
