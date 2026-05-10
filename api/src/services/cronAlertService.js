const fetch = require('node-fetch');

function enabled() {
  return !!`${process.env.CRON_ALERT_WEBHOOK_URL || ''}`.trim();
}

function sanitize(value, max = 400) {
  return `${value || ''}`
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted-link]')
    .replace(/\b\d{12,}\b/g, '[redacted-number]')
    .trim()
    .slice(0, max);
}

function buildCronAlertPayload({
  job,
  level = 'error',
  message,
  metadata = {},
} = {}) {
  return {
    source: 'adlo-api',
    type: 'cron_alert',
    level,
    job: sanitize(job, 80) || 'unknown',
    message: sanitize(message, 300) || 'Cron job needs attention.',
    metadata,
    occurred_at: new Date().toISOString(),
  };
}

async function notifyCronAlert(input = {}) {
  const webhookUrl = `${process.env.CRON_ALERT_WEBHOOK_URL || ''}`.trim();
  if (!webhookUrl) return { sent: false, reason: 'not_configured' };

  const payload = buildCronAlertPayload(input);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 5000,
    });
    if (!response.ok) {
      console.error('[cron-alert] webhook returned non-2xx', {
        status: response.status,
        job: payload.job,
      });
      return { sent: false, reason: 'webhook_failed', status: response.status };
    }
    return { sent: true };
  } catch (err) {
    console.error('[cron-alert] webhook error', {
      job: payload.job,
      message: sanitize(err?.message, 160),
    });
    return { sent: false, reason: 'webhook_error' };
  }
}

module.exports = {
  buildCronAlertPayload,
  enabled,
  notifyCronAlert,
};
