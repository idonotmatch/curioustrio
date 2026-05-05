const db = require('../db');
const { hashInviteToken, normalizeInviteToken } = require('../services/inviteToken');

function buildInviteTokenCandidates(token) {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return [];
  const hashed = hashInviteToken(normalized);
  return hashed === normalized ? [hashed] : [hashed, normalized];
}

async function create({ householdId, invitedEmail, invitedBy, token, expiresAt }) {
  const tokenHash = hashInviteToken(token);
  const result = await db.query(
    `INSERT INTO household_invites (household_id, invited_email_hash, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at`,
    [householdId, invitedEmail, invitedBy, tokenHash, expiresAt]
  );
  return result.rows[0];
}

async function findByToken(token) {
  const candidates = buildInviteTokenCandidates(token);
  if (!candidates.length) return null;
  const result = await db.query(
    `SELECT id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at
     FROM household_invites
     WHERE token = ANY($1::text[])
     ORDER BY CASE WHEN token = $2 THEN 0 ELSE 1 END
     LIMIT 1`,
    [candidates, candidates[0]]
  );
  return result.rows[0] || null;
}

async function accept(token, queryable = db) {
  const candidates = buildInviteTokenCandidates(token);
  if (!candidates.length) return null;
  const result = await queryable.query(
    `UPDATE household_invites
     SET status = 'accepted'
     WHERE token = ANY($1::text[]) AND status = 'pending'
     RETURNING id, household_id, invited_email_hash, invited_by, token, status, expires_at, created_at`,
    [candidates]
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
