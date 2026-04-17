const { getEnvValidationReport } = require('./validateEnv');
const { getSchemaCompatibilityReport } = require('./checkSchema');

async function runStartupChecks() {
  const envReport = getEnvValidationReport();
  if (!envReport.passed) {
    throw new Error(`Missing required environment configuration: ${envReport.missingRequired.join(', ')}`);
  }

  if (envReport.missingOptional.length) {
    console.warn(
      `[startup] Optional environment variables missing: ${envReport.missingOptional.join(', ')}`
    );
  }

  const schemaReport = await getSchemaCompatibilityReport();
  if (!schemaReport.passed) {
    const problems = [
      schemaReport.missingRequiredTables.length
        ? `missing tables: ${schemaReport.missingRequiredTables.join(', ')}`
        : null,
      schemaReport.missingRequiredColumns.length
        ? `missing columns: ${schemaReport.missingRequiredColumns.join(', ')}`
        : null,
    ].filter(Boolean);
    throw new Error(`Schema compatibility check failed (${problems.join('; ')})`);
  }

  if (schemaReport.missingOptionalTables.length) {
    console.warn(
      `[startup] Optional tables missing: ${schemaReport.missingOptionalTables.join(', ')}`
    );
  }

  console.log('[startup] Environment and schema checks passed');
}

module.exports = { runStartupChecks };
