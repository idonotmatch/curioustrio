const db = require('../db');

const REQUIRED_COLUMNS = [
  ['expenses', 'exclude_from_budget'],
  ['expenses', 'budget_exclusion_reason'],
  ['expenses', 'review_required'],
  ['expenses', 'review_mode'],
  ['expenses', 'review_source'],
  ['email_import_logs', 'subject'],
  ['email_import_logs', 'from_address'],
  ['email_import_logs', 'skip_reason'],
  ['email_import_logs', 'snippet'],
];

const REQUIRED_TABLES = [
  'email_import_feedback',
  'merchant_mappings',
  'duplicate_flags',
  'gmail_sender_preferences',
];

async function checkSchema() {
  const missing = [];

  for (const table of REQUIRED_TABLES) {
    const { rows } = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table]
    );
    if (!rows[0]?.exists) missing.push(`table: ${table}`);
  }

  for (const [table, column] of REQUIRED_COLUMNS) {
    const { rows } = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, column]
    );
    if (!rows[0]?.exists) missing.push(`column: ${table}.${column}`);
  }

  if (missing.length) {
    console.error('STARTUP SCHEMA CHECK FAILED — missing required DB objects:');
    for (const item of missing) console.error(`  ✗ ${item}`);
    console.error('Run pending migrations before starting the server.');
    process.exit(1);
  }

  console.log('Startup schema check passed.');
}

module.exports = checkSchema;
