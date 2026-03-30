const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
  // Fail loudly at startup rather than getting a cryptic ENOENT/socket error.
  // Common cause: env var pasted without the scheme prefix (e.g. "//host..."
  // instead of "postgresql://host...").
  throw new Error(
    `DATABASE_URL is missing or malformed (got: "${dbUrl.slice(0, 40)}..."). ` +
    'It must start with postgresql:// or postgres://'
  );
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
