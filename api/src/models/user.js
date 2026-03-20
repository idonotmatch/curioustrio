const db = require('../db');

async function findOrCreate({ auth0Id, name, email }) {
  const existing = await db.query(
    'SELECT * FROM users WHERE auth0_id = $1',
    [auth0Id]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const result = await db.query(
    `INSERT INTO users (auth0_id, name, email)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [auth0Id, name, email]
  );
  return result.rows[0];
}

async function findByAuth0Id(auth0Id) {
  const result = await db.query(
    'SELECT * FROM users WHERE auth0_id = $1',
    [auth0Id]
  );
  return result.rows[0] || null;
}

module.exports = { findOrCreate, findByAuth0Id };
