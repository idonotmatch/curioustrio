const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { MIGRATION_PLAN } = require('../src/db/migrationPlan');

const DEFAULT_TEST_DATABASE_URL = 'postgres://test:test@localhost:5432/expense_tracker_test';
const rawDatabaseUrl = process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');

function buildAdminUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function sslConfigFromEnv() {
  return process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false;
}

async function waitForDatabase(pool, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (index === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function recreateDatabase(adminPool, databaseName) {
  await adminPool.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()`,
    [databaseName]
  );
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
}

async function applyMigrations(databaseUrl) {
  const migrationPool = new Pool({
    connectionString: databaseUrl,
    ssl: sslConfigFromEnv(),
  });

  try {
    const discoveredFiles = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
    const missingFromPlan = discoveredFiles.filter((name) => !MIGRATION_PLAN.includes(name));
    const missingOnDisk = MIGRATION_PLAN.filter((name) => !discoveredFiles.includes(name));
    if (missingFromPlan.length || missingOnDisk.length) {
      throw new Error(
        [
          'migration plan is out of sync',
          missingFromPlan.length ? `unplanned files: ${missingFromPlan.join(', ')}` : null,
          missingOnDisk.length ? `missing files: ${missingOnDisk.join(', ')}` : null,
        ].filter(Boolean).join(' | ')
      );
    }

    for (const file of MIGRATION_PLAN) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      process.stdout.write(`[test-db] applying ${file}\n`);
      await migrationPool.query(sql);
    }
  } finally {
    await migrationPool.end();
  }
}

async function main() {
  const databaseUrl = new URL(rawDatabaseUrl);
  const databaseName = databaseUrl.pathname.replace(/^\//, '') || 'expense_tracker_test';
  const adminPool = new Pool({
    connectionString: buildAdminUrl(rawDatabaseUrl),
    ssl: sslConfigFromEnv(),
  });

  try {
    process.stdout.write(`[test-db] waiting for postgres at ${databaseUrl.host}\n`);
    await waitForDatabase(adminPool);
    process.stdout.write(`[test-db] recreating ${databaseName}\n`);
    await recreateDatabase(adminPool, databaseName);
  } finally {
    await adminPool.end();
  }

  await applyMigrations(rawDatabaseUrl);
  process.stdout.write(`[test-db] ready: ${rawDatabaseUrl}\n`);
}

main().catch((error) => {
  console.error('[test-db] failed to prepare integration database');
  console.error(error?.message || error);
  process.exit(1);
});
