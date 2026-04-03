const db = require('../db');

async function findByHousehold(householdId, { includeHidden = false } = {}) {
  const result = await db.query(
    `SELECT c.id,
            c.household_id,
            COALESCE(oco.display_name, c.name) AS name,
            c.name AS base_name,
            c.icon,
            c.color,
            c.parent_id,
            c.sort_order,
            c.created_at,
            (c.household_id IS NULL AND $1 IS NOT NULL) AS is_default,
            COALESCE(oco.hidden, FALSE) AS hidden,
            COALESCE(opo.display_name, p.name) AS parent_name
     FROM categories c
     LEFT JOIN category_household_overrides oco
       ON oco.category_id = c.id AND oco.household_id = $1
     LEFT JOIN categories p ON c.parent_id = p.id
     LEFT JOIN category_household_overrides opo
       ON opo.category_id = p.id AND opo.household_id = $1
     WHERE c.household_id = $1 OR c.household_id IS NULL
       ${includeHidden ? '' : 'AND COALESCE(oco.hidden, FALSE) = FALSE'}
     ORDER BY c.sort_order ASC, c.name ASC`,
    [householdId]
  );
  return result.rows;
}

async function findAccessibleById(id, householdId) {
  const result = await db.query(
    `SELECT c.*,
            (c.household_id IS NULL AND $2 IS NOT NULL) AS is_default,
            COALESCE(o.hidden, FALSE) AS hidden,
            o.display_name
     FROM categories c
     LEFT JOIN category_household_overrides o
       ON o.category_id = c.id AND o.household_id = $2
     WHERE c.id = $1
       AND (c.household_id = $2 OR c.household_id IS NULL)`,
    [id, householdId]
  );
  return result.rows[0] || null;
}

async function create({ householdId, name, icon, color, parentId = null }) {
  const result = await db.query(
    `INSERT INTO categories (household_id, name, icon, color, parent_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [householdId, name, icon, color, parentId]
  );
  return result.rows[0];
}

async function update({ id, householdId, name, icon, color, parentId, sortOrder }) {
  // parentId === undefined → don't touch parent_id column
  // parentId === null      → explicitly unassign
  // parentId === 'uuid'    → assign to parent
  const hasParent = parentId !== undefined;
  const hasSortOrder = sortOrder !== undefined;

  // Build params dynamically: $1=id, $2=householdId, $3=name, $4=icon, $5=color, [$6=parentId], [$N=sortOrder]
  const params = [id, householdId, name, icon, color];
  let parentIdx, sortOrderIdx;
  if (hasParent) { parentIdx = params.push(parentId); }
  if (hasSortOrder) { sortOrderIdx = params.push(sortOrder); }

  const result = await db.query(
    `UPDATE categories
     SET name  = COALESCE($3, name),
         icon  = COALESCE($4, icon),
         color = COALESCE($5, color)
         ${hasParent ? `, parent_id = $${parentIdx}` : ''}
         ${hasSortOrder ? `, sort_order = $${sortOrderIdx}` : ''}
     WHERE id = $1
       AND (household_id = $2 OR (household_id IS NULL AND $2 IS NULL))
     RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

async function upsertOverride({ categoryId, householdId, hidden, displayName }) {
  const result = await db.query(
    `INSERT INTO category_household_overrides (household_id, category_id, hidden, display_name)
     VALUES ($1, $2, COALESCE($3, FALSE), $4)
     ON CONFLICT (household_id, category_id)
     DO UPDATE SET
       hidden = COALESCE($3, category_household_overrides.hidden),
       display_name = COALESCE($4, category_household_overrides.display_name),
       updated_at = NOW()
     RETURNING *`,
    [householdId, categoryId, hidden, displayName && displayName.trim() ? displayName.trim() : null]
  );
  return result.rows[0] || null;
}

async function hideDefault({ id, householdId }) {
  await upsertOverride({ categoryId: id, householdId, hidden: true });
}

async function restoreDefault({ id, householdId }) {
  await upsertOverride({ categoryId: id, householdId, hidden: false });
}

async function renameDefaultForHousehold({ id, householdId, displayName }) {
  await upsertOverride({ categoryId: id, householdId, hidden: false, displayName });
  return findByHousehold(householdId, { includeHidden: true }).then(rows => rows.find(c => c.id === id) || null);
}

async function remove({ id, householdId }) {
  const category = await findAccessibleById(id, householdId);
  if (!category) return null;
  if (householdId && category.is_default) {
    await hideDefault({ id, householdId });
    return { hidden: true, category_id: id };
  }
  if (householdId) {
    await db.query('DELETE FROM categories WHERE id = $1 AND household_id = $2', [id, householdId]);
  } else {
    await db.query('DELETE FROM categories WHERE id = $1 AND household_id IS NULL', [id]);
  }
  return { deleted: true, category_id: id };
}

async function merge({ sourceId, targetId, householdId }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const sourceRes = await client.query(
      'SELECT id, name FROM categories WHERE id = $1 AND household_id = $2',
      [sourceId, householdId]
    );
    const targetRes = await client.query(
      'SELECT id, name FROM categories WHERE id = $1 AND household_id = $2',
      [targetId, householdId]
    );

    if (!sourceRes.rows.length || !targetRes.rows.length) {
      const err = new Error('Category not found');
      err.status = 404;
      throw err;
    }
    if (sourceId === targetId) {
      const err = new Error('Cannot merge a category into itself');
      err.status = 400;
      throw err;
    }

    const childRes = await client.query(
      'SELECT COUNT(*)::int AS count FROM categories WHERE household_id = $1 AND parent_id = $2',
      [householdId, sourceId]
    );
    if (childRes.rows[0].count > 0) {
      const err = new Error('Only categories without children can be merged');
      err.status = 400;
      throw err;
    }

    const expenseRes = await client.query(
      'UPDATE expenses SET category_id = $1 WHERE category_id = $2',
      [targetId, sourceId]
    );
    const mappingRes = await client.query(
      'UPDATE merchant_mappings SET category_id = $1, updated_at = NOW() WHERE household_id = $2 AND category_id = $3',
      [targetId, householdId, sourceId]
    );
    await client.query(
      'DELETE FROM category_suggestions WHERE household_id = $1 AND (leaf_id = $2 OR suggested_parent_id = $2)',
      [householdId, sourceId]
    );
    await client.query(
      'DELETE FROM categories WHERE id = $1 AND household_id = $2',
      [sourceId, householdId]
    );

    await client.query('COMMIT');
    return {
      source_id: sourceId,
      target_id: targetId,
      expense_count: expenseRes.rowCount,
      mapping_count: mappingRes.rowCount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findByHousehold,
  findAccessibleById,
  create,
  update,
  upsertOverride,
  hideDefault,
  restoreDefault,
  renameDefaultForHousehold,
  remove,
  merge,
};
