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
            parent.id AS parent_id, parent.name AS parent_name
     FROM category_suggestions cs
     JOIN categories leaf   ON cs.leaf_id           = leaf.id
     JOIN categories parent ON cs.suggested_parent_id = parent.id
     WHERE cs.household_id = $1 AND cs.status = 'pending'
     ORDER BY cs.created_at`,
    [householdId]
  );
  return result.rows.map(r => ({
    id: r.id,
    leaf:             { id: r.leaf_id,   name: r.leaf_name },
    suggested_parent: { id: r.parent_id, name: r.parent_name },
  }));
}

// Delete existing pending for this leaf, then insert new one.
async function upsertForLeaf(householdId, leafId, suggestedParentId) {
  await db.query(
    "DELETE FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
    [householdId, leafId]
  );
  await db.query(
    'INSERT INTO category_suggestions (household_id, leaf_id, suggested_parent_id) VALUES ($1, $2, $3)',
    [householdId, leafId, suggestedParentId]
  );
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
    await client.query('UPDATE categories SET parent_id = $1 WHERE id = $2', [suggested_parent_id, leaf_id]);
    await client.query('COMMIT');
    return result.rows[0];
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
