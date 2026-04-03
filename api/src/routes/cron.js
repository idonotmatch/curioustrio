const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/user');
const OAuthToken = require('../models/oauthToken');
const { importForUser } = require('../services/gmailImporter');

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

module.exports = router;
