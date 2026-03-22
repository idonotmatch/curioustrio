const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Supabase JWKS endpoint — uses ES256 asymmetric signing keys.
// Resolved from the first env var that is set:
//   1. SUPABASE_JWKS_URI    — explicit full URL (highest priority)
//   2. SUPABASE_URL         — full project URL (e.g. https://<ref>.supabase.co)
//   3. SUPABASE_PROJECT_REF — just the ref subdomain
// If none are set the URI will be null and every request returns 401.
function resolveJwksUri() {
  if (process.env.SUPABASE_JWKS_URI) return process.env.SUPABASE_JWKS_URI;
  if (process.env.SUPABASE_URL) return `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (process.env.SUPABASE_PROJECT_REF) return `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1/.well-known/jwks.json`;
  console.error(
    '[auth] FATAL: none of SUPABASE_JWKS_URI, SUPABASE_URL, or SUPABASE_PROJECT_REF is set. ' +
    'JWT verification will fail for every request — all API calls will return 401. ' +
    'Set SUPABASE_PROJECT_REF in your environment (see api/.env.example).'
  );
  return null;
}

const SUPABASE_JWKS_URI = resolveJwksUri();

let client;

function getClient() {
  if (!client) {
    client = jwksClient({
      jwksUri: SUPABASE_JWKS_URI,
      cache: true,
      rateLimit: true,
    });
  }
  return client;
}

function getKey(header, callback) {
  getClient().getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

async function authenticate(req, res, next) {
  if (!SUPABASE_JWKS_URI) {
    // Config is broken — return a 503 so the mobile client knows this is a
    // server misconfiguration, not an auth failure. A 401 would cause the mobile
    // client to sign the user out, creating a login loop.
    return res.status(503).json({ error: 'Server auth not configured (SUPABASE_PROJECT_REF missing)' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, { algorithms: ['ES256'] }, (err, payload) => {
        if (err) reject(err);
        else if (!payload) reject(new Error('Empty payload'));
        else resolve(payload);
      });
    });
    req.userId = decoded.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
