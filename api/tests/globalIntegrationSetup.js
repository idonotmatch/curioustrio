require('./setup');

const { Pool } = require('pg');

const formatError = (err) => {
  if (err?.errors?.length) {
    return err.errors.map((cause) => cause.message || cause).join('; ');
  }

  return err?.message || err;
};

module.exports = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: false,
    connectionTimeoutMillis: 1000,
  });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new Error([
      'Integration test database is unavailable.',
      `DATABASE_URL=${databaseUrl || '(not set)'}`,
      'Start the local Postgres test database or run unit tests with: npm run test:unit',
      `Original error: ${formatError(err)}`,
    ].join('\n'));
  } finally {
    await pool.end().catch(() => {});
  }
};
