const db = require('../db');
const { encrypt, decrypt } = require('../services/tokenCrypto');

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
  return { ...row, refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null };
}

async function findByUserId(userId, provider = 'google') {
  const result = await db.query(
    'SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { ...row, refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null };
}

module.exports = { upsert, findByUserId };
