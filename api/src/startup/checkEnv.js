/**
 * Validates required environment variables at startup.
 * Fails fast with a clear message rather than degrading silently at runtime.
 */

const REQUIRED = [
  {
    key: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API key for AI features',
  },
  {
    key: 'CRON_SECRET',
    description: 'Shared secret for authenticating cron job requests',
  },
  {
    key: 'EMAIL_HASH_SECRET',
    description: 'HMAC secret for hashing email addresses',
  },
  {
    key: 'TOKEN_ENCRYPTION_KEY',
    description: '64-char hex string (32 bytes) for encrypting OAuth refresh tokens',
    validate(val) {
      if (val.length !== 64) return 'must be exactly 64 hex characters (32 bytes)';
      if (!/^[0-9a-fA-F]+$/.test(val)) return 'must be a valid hex string';
      return null;
    },
  },
  {
    key: 'SUPABASE_JWKS_URI',
    description: 'Supabase JWKS endpoint URI for JWT verification',
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    description: 'Google OAuth client ID for Gmail integration',
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    description: 'Google OAuth client secret for Gmail integration',
  },
];

function checkEnv() {
  const errors = [];

  for (const spec of REQUIRED) {
    const val = process.env[spec.key];
    if (!val) {
      errors.push(`${spec.key} is not set — ${spec.description}`);
      continue;
    }
    if (spec.validate) {
      const msg = spec.validate(val);
      if (msg) errors.push(`${spec.key} is invalid: ${msg}`);
    }
  }

  if (errors.length) {
    console.error('STARTUP ENV CHECK FAILED — missing or invalid environment variables:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log('Startup env check passed.');
}

module.exports = checkEnv;
