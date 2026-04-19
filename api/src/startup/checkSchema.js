const db = require('../db');

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
  ['oauth_tokens', 'last_synced_at'],
  ['oauth_tokens', 'last_sync_attempted_at'],
  ['oauth_tokens', 'last_sync_error_at'],
  ['oauth_tokens', 'last_sync_error'],
  ['oauth_tokens', 'last_sync_source'],
  ['oauth_tokens', 'last_sync_status'],
  ['users', 'push_gmail_review_enabled'],
  ['users', 'push_insights_enabled'],
  ['users', 'push_recurring_enabled'],
  ['expense_items', 'product_id'],
  ['expense_items', 'comparable_key'],
  ['expense_items', 'product_match_confidence'],
  ['expense_items', 'estimated_unit_price'],
  ['expense_items', 'normalized_total_size_value'],
  ['expense_items', 'normalized_total_size_unit'],
  ['expense_items', 'item_type'],
  ['scenario_memory', 'last_recommended_timing_mode'],
  ['scenario_memory', 'last_choice_followed_recommendation'],
  ['scenario_memory', 'last_choice_source'],
];

const REQUIRED_TABLES = [
  'email_import_feedback',
  'products',
  'scenario_memory',
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

async function getSchemaCompatibilityReport() {
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

  return {
    missingRequiredTables,
    missingOptionalTables,
    missingRequiredColumns,
    passed:
      missingRequiredTables.length === 0
      && missingRequiredColumns.length === 0,
  };
}

module.exports = {
  REQUIRED_COLUMNS,
  REQUIRED_TABLES,
  OPTIONAL_TABLES,
  getSchemaCompatibilityReport,
};
