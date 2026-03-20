const db = require('../db');

async function findByHousehold(householdId) {
  const result = await db.query(
    'SELECT * FROM categories WHERE household_id = $1 OR household_id IS NULL ORDER BY name',
    [householdId]
  );
  return result.rows;
}

async function create({ householdId, name, icon, color }) {
  const result = await db.query(
    `INSERT INTO categories (household_id, name, icon, color)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [householdId, name, icon, color]
  );
  return result.rows[0];
}

async function update({ id, householdId, name, icon, color }) {
  const result = await db.query(
    `UPDATE categories SET name = COALESCE($1, name), icon = COALESCE($2, icon),
     color = COALESCE($3, color)
     WHERE id = $4 AND household_id = $5
     RETURNING *`,
    [name, icon, color, id, householdId]
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
