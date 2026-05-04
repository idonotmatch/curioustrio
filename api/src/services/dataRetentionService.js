const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const {
  emailImportRetentionDays,
  ingestFailureRetentionDays,
  ingestSuccessRetentionDays,
} = require('./storageMinimizationConfig');

async function runDataRetention() {
  const [emailImport, ingestAttempts] = await Promise.all([
    EmailImportLog.pruneOldRows(emailImportRetentionDays()),
    IngestAttemptLog.pruneOldRows({
      successDays: ingestSuccessRetentionDays(),
      failureDays: ingestFailureRetentionDays(),
    }),
  ]);

  return {
    email_import: emailImport,
    ingest_attempts: ingestAttempts,
  };
}

module.exports = {
  runDataRetention,
};
