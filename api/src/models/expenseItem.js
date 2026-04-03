const db = require('../db');

async function createBulk(expenseId, items) {
  if (!items || items.length === 0) return [];
  const values = items.map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`);
  const params = [expenseId];
  items.forEach((item, i) => {
    params.push(item.description, item.amount ?? null, item.sort_order ?? i, item.product_id ?? null);
  });
  const result = await db.query(
    `INSERT INTO expense_items (expense_id, description, amount, sort_order, product_id)
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
      const values = items.map((_, i) => `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`);
      const params = [expenseId];
      items.forEach((item, i) => {
        params.push(item.description, item.amount ?? null, i, item.product_id ?? null);
      });
      const result = await client.query(
        `INSERT INTO expense_items (expense_id, description, amount, sort_order, product_id)
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
