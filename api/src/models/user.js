const db = require('../db');

async function findOrCreate({ auth0Id, name, email }) {
  const result = await db.query(
    `INSERT INTO users (auth0_id, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_id)
     DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
     RETURNING id, auth0_id, name, email, household_id, created_at`,
    [auth0Id, name, email]
  );
  return result.rows[0];
}

async function findByAuth0Id(auth0Id) {
  const result = await db.query(
    'SELECT id, auth0_id, name, email, household_id, created_at FROM users WHERE auth0_id = $1',
    [auth0Id]
  );
  return result.rows[0] || null;
}

async function setHouseholdId(userId, householdId) {
  const result = await db.query(
    `UPDATE users SET household_id = $1 WHERE id = $2
     RETURNING id, auth0_id, name, email, household_id, created_at`,
    [householdId, userId]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    'SELECT id, auth0_id, name, email, household_id, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { findOrCreate, findByAuth0Id, findById, setHouseholdId };
