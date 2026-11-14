const IngestAttemptLog = require('../models/ingestAttemptLog');
const ReceiptScanJob = require('../models/receiptScanJob');

function number(value) {
  return Number(value) || 0;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

function buildRecommendations(jobs, parse) {
  const recommendations = [];
  const total = number(jobs.jobs);
  const completed = number(jobs.succeeded) + number(jobs.failed);
  const failed = number(jobs.failed);
  const stale = number(jobs.stale_queued) + number(jobs.stale_processing);
  const parseCounts = parse?.counts || {};
  const timeoutCount = (parse?.reasons || [])
    .filter((item) => ['ai_timeout', 'ai_unavailable'].includes(item.reason))
    .reduce((sum, item) => sum + number(item.count), 0);

  if (stale > 0 || number(jobs.worker_dead) > 0) {
    recommendations.push({
      code: 'receipt_jobs_stalled',
      level: 'error',
      message: `${stale + number(jobs.worker_dead)} receipt job${stale + number(jobs.worker_dead) === 1 ? '' : 's'} need worker attention.`,
    });
  }
  if (completed >= 3 && rate(failed, completed) >= 0.1) {
    recommendations.push({
      code: 'receipt_failure_rate_high',
      level: 'error',
      message: `${Math.round(rate(failed, completed) * 100)}% of completed receipt scans failed in this window.`,
    });
  }
  if (number(jobs.p95_end_to_end_ms) > 90_000) {
    recommendations.push({
      code: 'receipt_latency_high',
      level: 'warning',
      message: `Slow scans are taking about ${Math.round(number(jobs.p95_end_to_end_ms) / 1000)} seconds end to end.`,
    });
  }
  if (total >= 3 && rate(number(jobs.retried), total) >= 0.2) {
    recommendations.push({
      code: 'receipt_retry_rate_high',
      level: 'warning',
      message: `${Math.round(rate(number(jobs.retried), total) * 100)}% of receipt jobs required a retry.`,
    });
  }
  if (timeoutCount > 0) {
    recommendations.push({
      code: 'receipt_provider_timeouts',
      level: 'warning',
      message: `${timeoutCount} receipt parse attempt${timeoutCount === 1 ? '' : 's'} hit an AI timeout or outage.`,
    });
  }
  if (number(parseCounts.partial) > number(parseCounts.parsed) && number(parseCounts.attempts) >= 3) {
    recommendations.push({
      code: 'receipt_partial_rate_high',
      level: 'warning',
      message: 'More than half of recent receipt parses required user review.',
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      code: total ? 'receipt_health_ok' : 'receipt_no_recent_jobs',
      level: total ? 'ok' : 'info',
      message: total ? 'Receipt scanning is healthy in this window.' : 'No receipt scans were submitted in this window.',
    });
  }
  return recommendations;
}

async function getReceiptScanHealth(user, { days = 30 } = {}) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 90));
  const [jobSummary, parseSummary] = await Promise.all([
    ReceiptScanJob.summarizeByUser(user.id, { days: safeDays }),
    IngestAttemptLog.summarizeByUser(user.id, { source: 'receipt', days: safeDays }),
  ]);
  const jobs = jobSummary?.counts || {};
  const completed = number(jobs.succeeded) + number(jobs.failed);
  return {
    window_days: safeDays,
    jobs: {
      ...jobs,
      success_rate: rate(number(jobs.succeeded), completed),
      retry_rate: rate(number(jobs.retried), number(jobs.jobs)),
    },
    job_failure_reasons: jobSummary?.failure_reasons || [],
    parsing: parseSummary || { counts: {}, reasons: [], merchants: [] },
    recommendations: buildRecommendations(jobs, parseSummary),
  };
}

module.exports = { buildRecommendations, getReceiptScanHealth };
