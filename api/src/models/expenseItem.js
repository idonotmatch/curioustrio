const db = require('../db');

async function createBulk(expenseId, items) {
  if (!items || items.length === 0) return [];
  const values = items.map((_, i) => {
    const offset = i * 10;
    return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
  });
  const params = [expenseId];
  items.forEach((item, i) => {
    params.push(
      item.description,
      item.amount ?? null,
      item.sort_order ?? i,
      item.product_id ?? null,
      item.upc ?? null,
      item.sku ?? null,
      item.brand ?? null,
      item.product_size ?? null,
      item.pack_size ?? null,
      item.unit ?? null,
    );
  });
  const result = await db.query(
    `INSERT INTO expense_items (expense_id, description, amount, sort_order, product_id, upc, sku, brand, product_size, pack_size, unit)
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
      const values = items.map((_, i) => {
        const offset = i * 10;
        return `($1, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`;
      });
      const params = [expenseId];
      items.forEach((item, i) => {
        params.push(
          item.description,
          item.amount ?? null,
          i,
          item.product_id ?? null,
          item.upc ?? null,
          item.sku ?? null,
          item.brand ?? null,
          item.product_size ?? null,
          item.pack_size ?? null,
          item.unit ?? null,
        );
      });
      const result = await client.query(
        `INSERT INTO expense_items (expense_id, description, amount, sort_order, product_id, upc, sku, brand, product_size, pack_size, unit)
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
