const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/user');
const OAuthToken = require('../models/oauthToken');
const PushToken = require('../models/pushToken');
const { importForUser } = require('../services/gmailImporter');
const { dispatchInsightPushesForUser } = require('../services/insightPushDispatcher');
const IngestAttemptLog = require('../models/ingestAttemptLog');
const db = require('../db');

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
    const userIds = await OAuthToken.findAllWithGmail();
    console.log(`[cron/gmail-sync] starting — ${userIds.length} connected account(s)`);

    let usersProcessed = 0, totalImported = 0, totalSkipped = 0, totalFailed = 0;

    for (const userId of userIds) {
      try {
        const user = await User.findById(userId);
        if (!user) continue;

        const { imported, skipped, failed } = await importForUser(user);
        await OAuthToken.markSynced(userId);
        totalImported += imported;
        totalSkipped += skipped;
        totalFailed += failed;
        usersProcessed++;

        console.log(`[cron/gmail-sync] user=${userId} imported=${imported} skipped=${skipped} failed=${failed}`);
      } catch (e) {
        // Expired token or other per-user error — log and continue
        console.error(`[cron/gmail-sync] user=${userId} error:`, e.message);
      }
    }

    console.log(`[cron/gmail-sync] done — users=${usersProcessed} imported=${totalImported} skipped=${totalSkipped} failed=${totalFailed}`);
    res.json({ users_processed: usersProcessed, total_imported: totalImported, total_skipped: totalSkipped, total_failed: totalFailed });
  } catch (err) { next(err); }
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
        console.error(`[cron/insights-push] user=${userId} error:`, e.message);
      }
    }

    console.log(`[cron/insights-push] done — users=${usersProcessed} sent=${notificationsSent}`);
    res.json({ users_processed: usersProcessed, notifications_sent: notificationsSent });
  } catch (err) { next(err); }
});

// POST /cron/prune-logs — delete log rows older than 90 days
// Keeps ingest_attempt_log, email_import_feedback, and insight_events bounded.
router.post('/prune-logs', cronAuth, async (req, res, next) => {
  try {
    const retentionDays = 90;

    const ingestPruned = await IngestAttemptLog.pruneOlderThan(retentionDays);

    const feedbackResult = await db.query(
      `DELETE FROM email_import_feedback WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [retentionDays]
    );
    const feedbackPruned = feedbackResult.rowCount ?? 0;

    const eventsResult = await db.query(
      `DELETE FROM insight_events WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [retentionDays]
    );
    const eventsPruned = eventsResult.rowCount ?? 0;

    console.log(`[cron/prune-logs] ingest_attempt_log=${ingestPruned} email_import_feedback=${feedbackPruned} insight_events=${eventsPruned}`);
    res.json({ retention_days: retentionDays, ingest_attempt_log: ingestPruned, email_import_feedback: feedbackPruned, insight_events: eventsPruned });
  } catch (err) { next(err); }
});

module.exports = router;
