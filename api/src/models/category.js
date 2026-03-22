const db = require('../db');

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT c.*, p.name AS parent_name
     FROM categories c
     LEFT JOIN categories p ON c.parent_id = p.id
     WHERE c.household_id = $1 OR c.household_id IS NULL
     ORDER BY c.sort_order ASC, c.name ASC`,
    [householdId]
  );
  return result.rows;
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

async function remove({ id, householdId }) {
  await db.query(
    'DELETE FROM categories WHERE id = $1 AND household_id = $2',
    [id, householdId]
  );
}

module.exports = { findByHousehold, create, update, remove };
