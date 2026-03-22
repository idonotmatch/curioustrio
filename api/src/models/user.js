const db = require('../db');

// Upsert by provider_uid.
async function findOrCreateByProviderUid({ providerUid, name, email }) {
  const result = await db.query(
    `INSERT INTO users (provider_uid, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider_uid)
     DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [providerUid, name || null, email || null]
  );
  return result.rows[0];
}

async function findByProviderUid(providerUid) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE provider_uid = $1',
    [providerUid]
  );
  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query(
    'SELECT id, provider_uid, name, email, household_id, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function updateProviderUid(userId, providerUid) {
  const result = await db.query(
    `UPDATE users SET provider_uid = $1 WHERE id = $2
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [providerUid, userId]
  );
  return result.rows[0] || null;
}

async function setHouseholdId(userId, householdId) {
  const result = await db.query(
    `UPDATE users SET household_id = $1 WHERE id = $2
     RETURNING id, provider_uid, name, email, household_id, created_at`,
    [householdId, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  findOrCreateByProviderUid,
  findByProviderUid,
  findByEmail,
  findById,
  updateProviderUid,
  setHouseholdId,
};
