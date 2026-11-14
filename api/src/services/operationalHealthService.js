const db = require('../db');
const { notifyCronAlert } = require('./cronAlertService');

const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
let lastAlertFingerprint = null;
let lastAlertAt = 0;

function number(value) {
  return Number(value) || 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

async function loadOperationalMetrics() {
  const [jobsResult, receiptsResult, importsResult, pushResult] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'queued' AND available_at < NOW() - INTERVAL '5 minutes')::int AS stale_queued,
         COUNT(*) FILTER (WHERE status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes')::int AS stale_running,
         COUNT(*) FILTER (WHERE status = 'dead' AND completed_at >= NOW() - INTERVAL '24 hours')::int AS dead_24h
       FROM background_jobs`
    ),
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('succeeded', 'failed'))::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'queued' AND created_at < NOW() - INTERVAL '2 minutes')::int AS stale_queued,
         COUNT(*) FILTER (WHERE status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes')::int AS stale_processing
       FROM receipt_scan_jobs
       WHERE created_at >= NOW() - INTERVAL '24 hours'`
    ),
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'imported')::int AS imported,
         COUNT(*) FILTER (
           WHERE status = 'failed'
             AND COALESCE(skip_reason, '') NOT IN ('404', 'gmail_message_unavailable')
         )::int AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
       FROM email_import_log
       WHERE imported_at >= NOW() - INTERVAL '24 hours'`
    ),
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('delivered', 'failed'))::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (
           WHERE status = 'accepted'
             AND expo_ticket_id IS NOT NULL
             AND created_at < NOW() - INTERVAL '15 minutes'
         )::int AS stale_receipts
       FROM notification_deliveries
       WHERE created_at >= NOW() - INTERVAL '24 hours'`
    ),
  ]);
  return {
    background_jobs: jobsResult.rows[0] || {},
    receipt_scans: receiptsResult.rows[0] || {},
    email_imports: importsResult.rows[0] || {},
    push_notifications: pushResult.rows[0] || {},
  };
}

function assessOperationalMetrics(metrics) {
  const findings = [];
  const jobs = metrics.background_jobs || {};
  const receipts = metrics.receipt_scans || {};
  const imports = metrics.email_imports || {};
  const push = metrics.push_notifications || {};
  const staleJobs = number(jobs.stale_queued) + number(jobs.stale_running);
  const staleReceipts = number(receipts.stale_queued) + number(receipts.stale_processing);

  if (staleJobs > 0) findings.push({ code: 'background_jobs_stalled', level: 'error', count: staleJobs });
  if (number(jobs.dead_24h) > 0) findings.push({ code: 'background_jobs_dead', level: 'error', count: number(jobs.dead_24h) });
  if (staleReceipts > 0) findings.push({ code: 'receipt_scans_stalled', level: 'error', count: staleReceipts });
  if (number(receipts.completed) >= 3 && ratio(number(receipts.failed), number(receipts.completed)) >= 0.2) {
    findings.push({ code: 'receipt_failure_rate_high', level: 'error', count: number(receipts.failed) });
  }
  if (number(imports.failed) >= 3 && ratio(number(imports.failed), number(imports.imported) + number(imports.failed)) >= 0.1) {
    findings.push({ code: 'email_import_failures_high', level: 'error', count: number(imports.failed) });
  }
  if (number(push.stale_receipts) > 0) {
    findings.push({ code: 'push_receipts_stalled', level: 'warning', count: number(push.stale_receipts) });
  }
  if (number(push.completed) >= 3 && ratio(number(push.failed), number(push.completed)) >= 0.2) {
    findings.push({ code: 'push_failure_rate_high', level: 'warning', count: number(push.failed) });
  }
  return findings;
}

function shouldSendAlert(findings, now = Date.now()) {
  const fingerprint = findings.map((item) => `${item.code}:${item.count}`).sort().join('|');
  if (!fingerprint) return { send: false, fingerprint };
  if (fingerprint === lastAlertFingerprint && now - lastAlertAt < ALERT_COOLDOWN_MS) {
    return { send: false, fingerprint };
  }
  return { send: true, fingerprint };
}

async function runOperationalHealthCheck({ notify = false } = {}) {
  const metrics = await loadOperationalMetrics();
  const findings = assessOperationalMetrics(metrics);
  const result = {
    ok: !findings.some((item) => item.level === 'error'),
    checked_at: new Date().toISOString(),
    metrics,
    findings,
  };
  if (notify) {
    const alert = shouldSendAlert(findings);
    if (alert.send) {
      const response = await notifyCronAlert({
        job: 'operational-health',
        level: result.ok ? 'warning' : 'error',
        message: `Operational health found ${findings.length} issue${findings.length === 1 ? '' : 's'}: ${findings.map((item) => item.code).join(', ')}.`,
        metadata: { findings, metrics },
      });
      if (response.sent) {
        lastAlertFingerprint = alert.fingerprint;
        lastAlertAt = Date.now();
      }
    }
  }
  return result;
}

function resetAlertStateForTests() {
  lastAlertFingerprint = null;
  lastAlertAt = 0;
}

module.exports = {
  assessOperationalMetrics,
  loadOperationalMetrics,
  resetAlertStateForTests,
  runOperationalHealthCheck,
  shouldSendAlert,
};
