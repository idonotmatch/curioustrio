#!/usr/bin/env node

const db = require('../src/db');

const REQUIRED_COLUMNS = [
  ['expenses', 'review_required'],
  ['expenses', 'review_mode'],
  ['expenses', 'review_source'],
  ['expenses', 'exclude_from_budget'],
  ['expenses', 'budget_exclusion_reason'],
  ['email_import_log', 'subject'],
  ['email_import_log', 'from_address'],
  ['email_import_log', 'skip_reason'],
  ['email_import_log', 'snippet'],
];

const REQUIRED_TABLES = [
  'email_import_feedback',
];

const OPTIONAL_TABLES = [
  'duplicate_flags',
  'gmail_sender_preferences',
];

async function tableExists(tableName) {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return !!result.rows[0]?.exists;
}

async function columnExists(tableName, columnName) {
  const result = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );
  return !!result.rows[0]?.exists;
}

async function main() {
  const missingRequiredTables = [];
  const missingOptionalTables = [];
  const missingRequiredColumns = [];

  for (const tableName of REQUIRED_TABLES) {
    if (!(await tableExists(tableName))) missingRequiredTables.push(tableName);
  }

  for (const tableName of OPTIONAL_TABLES) {
    if (!(await tableExists(tableName))) missingOptionalTables.push(tableName);
  }

  for (const [tableName, columnName] of REQUIRED_COLUMNS) {
    if (!(await columnExists(tableName, columnName))) {
      missingRequiredColumns.push(`${tableName}.${columnName}`);
    }
  }

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
