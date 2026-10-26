const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const BackgroundJob = require('../models/backgroundJob');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');
const { pruneReceiptScanUsage } = require('./receiptScanUsageService');
const {
  emailImportRetentionDays,
  freshnessEventRetentionDays,
  ingestFailureRetentionDays,
  ingestSuccessRetentionDays,
} = require('./storageMinimizationConfig');

async function runDataRetention() {
  const [emailImport, ingestAttempts, backgroundJobs, freshnessEvents, receiptScanUsage] = await Promise.all([
    EmailImportLog.pruneOldRows(emailImportRetentionDays()),
    IngestAttemptLog.pruneOldRows({
      successDays: ingestSuccessRetentionDays(),
      failureDays: ingestFailureRetentionDays(),
    }),
    BackgroundJob.pruneFinished(),
    HouseholdFreshnessEvent.pruneOldRows(freshnessEventRetentionDays()),
    pruneReceiptScanUsage(),
  ]);

  return {
    email_import: emailImport,
    ingest_attempts: ingestAttempts,
    background_jobs: backgroundJobs,
    freshness_events: freshnessEvents,
    receipt_scan_usage: receiptScanUsage,
  };
}

module.exports = {
  runDataRetention,
};
