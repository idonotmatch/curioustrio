#!/usr/bin/env node

const db = require('../src/db');
const { getSchemaCompatibilityReport } = require('../src/startup/checkSchema');

async function main() {
  const {
    missingRequiredTables,
    missingOptionalTables,
    missingRequiredColumns,
  } = await getSchemaCompatibilityReport();

  if (!missingRequiredTables.length && !missingRequiredColumns.length && !missingOptionalTables.length) {
    console.log('Schema compatibility check passed. All required and optional Gmail/review artifacts are present.');
    return;
  }

  if (missingRequiredTables.length || missingRequiredColumns.length) {
    console.error('Schema compatibility check failed.');
    if (missingRequiredTables.length) {
      console.error(`Missing required tables: ${missingRequiredTables.join(', ')}`);
    }
    if (missingRequiredColumns.length) {
      console.error(`Missing required columns: ${missingRequiredColumns.join(', ')}`);
    }
  } else {
    console.log('Schema compatibility check passed for required artifacts.');
  }

  if (missingOptionalTables.length) {
    console.warn(`Missing optional tables (best-effort features will degrade): ${missingOptionalTables.join(', ')}`);
  }

  if (missingRequiredTables.length || missingRequiredColumns.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Schema compatibility check failed to run:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {
      // no-op
    }
  });
