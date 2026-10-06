const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const BackgroundJob = require('../models/backgroundJob');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');
const {
  emailImportRetentionDays,
  freshnessEventRetentionDays,
  ingestFailureRetentionDays,
  ingestSuccessRetentionDays,
} = require('./storageMinimizationConfig');

async function runDataRetention() {
  const [emailImport, ingestAttempts, backgroundJobs, freshnessEvents] = await Promise.all([
    EmailImportLog.pruneOldRows(emailImportRetentionDays()),
    IngestAttemptLog.pruneOldRows({
      successDays: ingestSuccessRetentionDays(),
      failureDays: ingestFailureRetentionDays(),
    }),
    BackgroundJob.pruneFinished(),
    HouseholdFreshnessEvent.pruneOldRows(freshnessEventRetentionDays()),
  ]);

  return {
    email_import: emailImport,
    ingest_attempts: ingestAttempts,
    background_jobs: backgroundJobs,
    freshness_events: freshnessEvents,
  };
}

module.exports = {
  runDataRetention,
};
