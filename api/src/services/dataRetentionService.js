const EmailImportLog = require('../models/emailImportLog');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const BackgroundJob = require('../models/backgroundJob');
const HouseholdFreshnessEvent = require('../models/householdFreshnessEvent');
const NotificationDelivery = require('../models/notificationDelivery');
const { pruneReceiptScanUsage } = require('./receiptScanUsageService');
const {
  emailImportRetentionDays,
  freshnessEventRetentionDays,
  notificationDeliveryRetentionDays,
  ingestFailureRetentionDays,
  ingestSuccessRetentionDays,
} = require('./storageMinimizationConfig');

async function runDataRetention() {
  const [emailImport, ingestAttempts, backgroundJobs, freshnessEvents, receiptScanUsage, notificationDeliveries] = await Promise.all([
    EmailImportLog.pruneOldRows(emailImportRetentionDays()),
    IngestAttemptLog.pruneOldRows({
      successDays: ingestSuccessRetentionDays(),
      failureDays: ingestFailureRetentionDays(),
    }),
    BackgroundJob.pruneFinished(),
    HouseholdFreshnessEvent.pruneOldRows(freshnessEventRetentionDays()),
    pruneReceiptScanUsage(),
    NotificationDelivery.pruneOldRows(notificationDeliveryRetentionDays()),
  ]);

  return {
    email_import: emailImport,
    ingest_attempts: ingestAttempts,
    background_jobs: backgroundJobs,
    freshness_events: freshnessEvents,
    receipt_scan_usage: receiptScanUsage,
    notification_deliveries: notificationDeliveries,
  };
}

module.exports = {
  runDataRetention,
};
