const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const BackgroundJob = require('../models/backgroundJob');
const {
  emailImportRetentionDays,
  ingestFailureRetentionDays,
  ingestSuccessRetentionDays,
} = require('./storageMinimizationConfig');

async function runDataRetention() {
  const [emailImport, ingestAttempts, backgroundJobs] = await Promise.all([
    EmailImportLog.pruneOldRows(emailImportRetentionDays()),
    IngestAttemptLog.pruneOldRows({
      successDays: ingestSuccessRetentionDays(),
      failureDays: ingestFailureRetentionDays(),
    }),
    BackgroundJob.pruneFinished(),
  ]);

  return {
    email_import: emailImport,
    ingest_attempts: ingestAttempts,
    background_jobs: backgroundJobs,
  };
}

module.exports = {
  runDataRetention,
};
