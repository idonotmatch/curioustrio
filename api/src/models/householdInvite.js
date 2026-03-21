const db = require('../db');

async function create({ householdId, invitedEmail, invitedBy, token, expiresAt }) {
  const result = await db.query(
    `INSERT INTO household_invites (household_id, invited_email, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, household_id, invited_email, invited_by, token, status, expires_at, created_at`,
    [householdId, invitedEmail, invitedBy, token, expiresAt]
  );
  return result.rows[0];
}

async function findByToken(token) {
  const result = await db.query(
    `SELECT id, household_id, invited_email, invited_by, token, status, expires_at, created_at
     FROM household_invites WHERE token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

async function accept(token) {
  const result = await db.query(
    `UPDATE household_invites SET status = 'accepted' WHERE token = $1 AND status = 'pending'
     RETURNING id, household_id, invited_email, invited_by, token, status, expires_at, created_at`,
    [token]
  );
  return result.rows[0] || null;
}

async function expireOld() {
  const result = await db.query(
    `UPDATE household_invites SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()`
  );
  return result.rowCount;
}

module.exports = { create, findByToken, accept, expireOld };
