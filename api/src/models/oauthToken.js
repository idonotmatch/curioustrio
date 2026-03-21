const db = require('../db');

async function upsert({ userId, provider = 'google', accessToken, refreshToken, expiresAt, scope }) {
  const result = await db.query(
    `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = NOW()
     RETURNING *`,
    [userId, provider, accessToken, refreshToken, expiresAt, scope]
  );
  return result.rows[0];
}

async function findByUserId(userId, provider = 'google') {
  const result = await db.query(
    'SELECT * FROM oauth_tokens WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return result.rows[0] || null;
}

module.exports = { upsert, findByUserId };
