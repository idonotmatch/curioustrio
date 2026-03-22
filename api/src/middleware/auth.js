const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Supabase JWKS endpoint — uses ES256 asymmetric signing keys
const SUPABASE_JWKS_URI =
  process.env.SUPABASE_JWKS_URI ||
  `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1/.well-known/jwks.json`;

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
