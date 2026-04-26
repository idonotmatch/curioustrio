const db = require('../db');
const { encrypt, decrypt } = require('../services/tokenCrypto');

function serializeTokenRow(row, { includeRefreshToken = false } = {}) {
  if (!row) return null;
  return {
    ...row,
    refresh_token: includeRefreshToken && row.refresh_token ? decrypt(row.refresh_token) : null,
  };
}

async function upsert({ userId, provider = 'google', accessToken, refreshToken, expiresAt, scope }) {
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
  const result = await db.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
       expires_at    = EXCLUDED.expires_at,
       scope         = EXCLUDED.scope,
       updated_at    = NOW()
     RETURNING *`,
    [userId, provider, null, encryptedRefresh, expiresAt, scope]
  );
  const row = result.rows[0];
  return serializeTokenRow(row);
}

async function findByUserId(userId, provider = 'google') {
  const result = await db.query(
    'SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return serializeTokenRow(result.rows[0]);
}

async function findCredentialsByUserId(userId, provider = 'google') {
  const result = await db.query(
    'SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return serializeTokenRow(result.rows[0], { includeRefreshToken: true });
}

async function findAllWithGmail() {
  const result = await db.query(
    `SELECT user_id FROM oauth_tokens WHERE provider = 'google'`
  );
  return result.rows.map(r => r.user_id);
}

async function markSyncAttempt(userId, { provider = 'google', source = null } = {}) {
  const result = await db.query(
    `UPDATE oauth_tokens
     SET last_sync_attempted_at = NOW(),
         last_sync_status = 'running',
         last_sync_source = COALESCE($3, last_sync_source),
         updated_at = NOW()
     WHERE user_id = $1 AND provider = $2
     RETURNING *`,
    [userId, provider, source]
  );
  return serializeTokenRow(result.rows[0]);
}

async function markSynced(userId, { provider = 'google', source = null } = {}) {
  const result = await db.query(
    `UPDATE oauth_tokens
     SET last_synced_at = NOW(),
         last_sync_attempted_at = NOW(),
         last_sync_status = 'success',
         last_sync_source = COALESCE($3, last_sync_source),
         last_sync_error = NULL,
         last_sync_error_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND provider = $2
     RETURNING *`,
    [userId, provider, source]
  );
  return serializeTokenRow(result.rows[0]);
}

async function markSyncFailure(userId, { provider = 'google', source = null, error = null } = {}) {
  const result = await db.query(
    `UPDATE oauth_tokens
     SET last_sync_attempted_at = NOW(),
         last_sync_error_at = NOW(),
         last_sync_error = $4,
         last_sync_status = 'failed',
         last_sync_source = COALESCE($3, last_sync_source),
         updated_at = NOW()
     WHERE user_id = $1 AND provider = $2
     RETURNING *`,
    [userId, provider, source, error]
  );
  return serializeTokenRow(result.rows[0]);
}

module.exports = {
  upsert,
  findByUserId,
  findCredentialsByUserId,
  findAllWithGmail,
  markSyncAttempt,
  markSynced,
  markSyncFailure,
};
