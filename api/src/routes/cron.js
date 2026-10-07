const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { runDataRetention } = require('../services/dataRetentionService');
const { notifyCronAlert } = require('../services/cronAlertService');
const { captureException } = require('../services/observability');
const { runScheduledGmailSync } = require('../services/gmailSyncService');
const { runInsightPushCron } = require('../services/insightPushCronService');

// Middleware: verify the request carries the shared CRON_SECRET.
// Render (or any scheduler) passes this as a bearer token.
// Uses timing-safe comparison to prevent secret enumeration via timing attacks.
function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET env var is not set');
    return res.status(500).json({ error: 'Cron not configured' });
  }
  const auth = req.headers['authorization'] || '';
  const expected = `Bearer ${secret}`;
  const valid = auth.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /cron/gmail-sync — sync Gmail for all connected users
router.post('/gmail-sync', cronAuth, async (req, res, next) => {
  try {
    const result = await runScheduledGmailSync({
      onAccountError(error, context) {
        captureException(error, { area: 'gmail_scheduler', phase: context.phase });
      },
    });
    console.log('[cron/gmail-sync] completed', result);

    if (!result.ok) {
      await notifyCronAlert({
        job: 'gmail-sync',
        level: result.users_failed > 0 ? 'error' : 'warning',
        message: result.users_failed > 0
          ? 'Gmail scheduler could not sync one or more connected accounts.'
          : 'Gmail scheduler completed with failed message imports.',
        metadata: result,
      });
    }
    res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    captureException(err, { area: 'gmail_scheduler', phase: 'run' });
    await notifyCronAlert({
      job: 'gmail-sync',
      level: 'error',
      message: 'Gmail scheduler failed before account processing completed.',
    });
    next(err);
  }
});

router.post('/insights-push', cronAuth, async (req, res, next) => {
  try {
    const result = await runInsightPushCron();
    console.log('[cron/insights-push] completed', result);
    res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    captureException(err, { area: 'insights_push_scheduler', phase: 'run' });
    await notifyCronAlert({
      job: 'insights-push',
      level: 'error',
      message: 'Insight push scheduler failed before user processing completed.',
    });
    next(err);
  }
});

router.post('/data-retention', cronAuth, async (req, res, next) => {
  try {
    const result = await runDataRetention();
    console.log('[cron/data-retention] done', result);
    res.json(result);
  } catch (err) {
    captureException(err, { area: 'data_retention_scheduler', phase: 'run' });
    await notifyCronAlert({
      job: 'data-retention',
      level: 'error',
      message: 'Data retention scheduler failed.',
    });
    next(err);
  }
});

module.exports = router;
