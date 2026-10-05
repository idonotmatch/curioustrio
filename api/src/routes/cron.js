const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const PushToken = require('../models/pushToken');
const { dispatchInsightPushesForUser } = require('../services/insightPushDispatcher');
const { runDataRetention } = require('../services/dataRetentionService');
const { notifyCronAlert } = require('../services/cronAlertService');
const { captureException } = require('../services/observability');
const { runScheduledGmailSync } = require('../services/gmailSyncService');

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
    const userIds = await PushToken.findAllUserIds();
    console.log(`[cron/insights-push] starting — ${userIds.length} user(s) with push token(s)`);

    let usersProcessed = 0;
    let notificationsSent = 0;

    for (const userId of userIds) {
      try {
        const user = await User.findById(userId);
        if (!user) continue;
        const result = await dispatchInsightPushesForUser(user);
        usersProcessed++;
        notificationsSent += Number(result.sent || 0);
        console.log(`[cron/insights-push] user=${userId} sent=${result.sent || 0} considered=${result.considered || 0}`);
      } catch (e) {
        notifyCronAlert({
          job: 'insights-push',
          level: 'error',
          message: 'Insight push scheduler failed for a user.',
          metadata: { user_id: userId },
        }).catch(() => {});
        console.error(`[cron/insights-push] user=${userId} error:`, e.message);
      }
    }

    console.log(`[cron/insights-push] done — users=${usersProcessed} sent=${notificationsSent}`);
    res.json({ users_processed: usersProcessed, notifications_sent: notificationsSent });
  } catch (err) { next(err); }
});

router.post('/data-retention', cronAuth, async (req, res, next) => {
  try {
    const result = await runDataRetention();
    console.log('[cron/data-retention] done', result);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
