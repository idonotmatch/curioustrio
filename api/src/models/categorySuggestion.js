const db = require('../db');

async function countPending(householdId) {
  const result = await db.query(
    "SELECT COUNT(*) FROM category_suggestions WHERE household_id = $1 AND status = 'pending'",
    [householdId]
  );
  return parseInt(result.rows[0].count, 10);
}

async function getPending(householdId) {
  const result = await db.query(
    `SELECT cs.id,
            leaf.id   AS leaf_id,   leaf.name   AS leaf_name,
            parent.id AS parent_id, parent.name AS parent_name,
            COALESCE(expense_counts.expense_count, 0) AS expense_count,
            COALESCE(expense_counts.sample_merchants, ARRAY[]::text[]) AS sample_merchants
     FROM category_suggestions cs
     JOIN categories leaf   ON cs.leaf_id           = leaf.id
     JOIN categories parent ON cs.suggested_parent_id = parent.id
     LEFT JOIN (
       SELECT
         e.category_id,
         COUNT(*)::int AS expense_count,
         ARRAY(
           SELECT DISTINCT e2.merchant
           FROM expenses e2
           WHERE e2.category_id = e.category_id
             AND e2.merchant IS NOT NULL
             AND e2.merchant <> ''
           ORDER BY e2.merchant
           LIMIT 3
         ) AS sample_merchants
       FROM expenses e
       WHERE e.household_id = $1
         AND e.status = 'confirmed'
         AND e.category_id IS NOT NULL
       GROUP BY e.category_id
     ) expense_counts ON expense_counts.category_id = leaf.id
     WHERE cs.household_id = $1 AND cs.status = 'pending'
     ORDER BY cs.created_at`,
    [householdId]
  );
  return result.rows.map(r => ({
    id: r.id,
    leaf:             { id: r.leaf_id,   name: r.leaf_name },
    suggested_parent: { id: r.parent_id, name: r.parent_name },
    expense_count: Number(r.expense_count) || 0,
    sample_merchants: Array.isArray(r.sample_merchants) ? r.sample_merchants.filter(Boolean) : [],
  }));
}

// Delete existing pending for this leaf, then insert new one.
async function upsertForLeaf(householdId, leafId, suggestedParentId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ownerCheck = await client.query(
      'SELECT id FROM categories WHERE id = $1 AND household_id = $2',
      [leafId, householdId]
    );
    if (!ownerCheck.rows.length) {
      await client.query('ROLLBACK');
      client.release();
      return;
    }
    await client.query(
      "DELETE FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
      [householdId, leafId]
    );
    await client.query(
      'INSERT INTO category_suggestions (household_id, leaf_id, suggested_parent_id) VALUES ($1, $2, $3)',
      [householdId, leafId, suggestedParentId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Accept: set status + update leaf's parent_id atomically.
async function accept(id, householdId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE category_suggestions
       SET status = 'accepted'
       WHERE id = $1 AND household_id = $2 AND status = 'pending'
       RETURNING leaf_id, suggested_parent_id`,
      [id, householdId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const { leaf_id, suggested_parent_id } = result.rows[0];
    await client.query(
      'UPDATE categories SET parent_id = $1 WHERE id = $2 AND household_id = $3',
      [suggested_parent_id, leaf_id, householdId]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function reject(id, householdId) {
  const result = await db.query(
    `UPDATE category_suggestions
     SET status = 'rejected'
     WHERE id = $1 AND household_id = $2 AND status = 'pending'
     RETURNING id`,
    [id, householdId]
  );
  return result.rows[0] || null;
}

module.exports = { countPending, getPending, upsertForLeaf, accept, reject };
