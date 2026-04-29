const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../db');
const User = require('../models/user');
const OAuthToken = require('../models/oauthToken');
const EmailImportLog = require('../models/emailImportLog');
const GmailSenderPreference = require('../models/gmailSenderPreference');
const { getAuthUrl, exchangeCode, disconnectGmailConnection } = require('../services/gmailClient');
const { importForUser, retryFailedImportLog, retryFailedImportsForUser } = require('../services/gmailImporter');
const { getGmailImportQualitySummary } = require('../services/gmailImportQualityService');
const { aiEndpoints } = require('../middleware/rateLimit');

function gmailAppReturnUrl() {
  return process.env.GMAIL_APP_REDIRECT_URI || 'adlo://gmail-import?connected=1';
}

function classifyGmailImportError(err) {
  const message = `${err?.message || ''}`;
  const normalized = message.toLowerCase();

  if (
    normalized.includes('invalid_grant')
    || normalized.includes('invalid credentials')
    || normalized.includes('token has been expired')
    || normalized.includes('gmail not connected')
  ) {
    return {
      status: 401,
      message: 'Gmail connection expired. Reconnect Gmail and try again.',
    };
  }

  if (
    normalized.includes('google_client_id')
    || normalized.includes('google_client_secret')
    || normalized.includes('google_redirect_uri')
  ) {
    return {
      status: 500,
      message: 'Gmail sync is not configured correctly.',
    };
  }

  return {
    status: 502,
    message: 'Gmail sync could not start. Try again in a moment.',
  };
}

function serializeSyncStatus(token, email = null) {
  return {
    connected: !!token,
    email: email || null,
    last_synced_at: token?.last_synced_at || null,
    last_sync_attempted_at: token?.last_sync_attempted_at || null,
    last_sync_error_at: token?.last_sync_error_at || null,
    last_sync_error: token?.last_sync_error || null,
    last_sync_source: token?.last_sync_source || null,
    last_sync_status: token?.last_sync_status || null,
  };
}

function sanitizeErrorDetail(err) {
  const value = `${err?.message || ''}`.trim();
  if (!value) return null;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[redacted-link]')
    .replace(/\b\d{12,}\b/g, '[redacted-number]')
    .slice(0, 180);
}

// GET /gmail/auth — redirect to Google OAuth (requires auth to get user id for state param)
router.get('/auth', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const url = await getAuthUrl(user.id);
    res.json({ url });
  } catch (err) { next(err); }
});

// GET /gmail/callback — exchange code, save token (no auth — called by Google redirect)
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state: stateToken } = req.query;
    if (!code || !stateToken) return res.status(400).json({ error: 'Missing code or state' });

    const stateRow = await db.query(
      `DELETE FROM gmail_oauth_states
       WHERE token = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [stateToken]
    );
    if (!stateRow.rows.length) {
      return res.status(400).json({ error: 'Invalid or expired state token' });
    }

    const userId = stateRow.rows[0].user_id;
    const tokens = await exchangeCode(code);
    await OAuthToken.upsert({ userId, ...tokens, accessToken: null }); // do not persist access_token
    const returnUrl = gmailAppReturnUrl();
    const escapedReturnUrl = returnUrl.replace(/"/g, '&quot;');
    res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=${escapedReturnUrl}" />
    <title>Gmail connected</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;">
    <h2>Gmail connected</h2>
    <p>Returning to Adlo…</p>
    <p><a href="${escapedReturnUrl}">Open Adlo</a></p>
    <script>
      window.location.replace(${JSON.stringify(returnUrl)});
    </script>
  </body>
</html>`);
  } catch (err) { next(err); }
});

// GET /gmail/status — is Gmail connected?
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const token = await OAuthToken.findByUserId(user.id);
    res.json(serializeSyncStatus(token, user.email));
  } catch (err) { next(err); }
});

router.delete('/connection', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const result = await disconnectGmailConnection(user.id);
    res.json({
      disconnected: true,
      revoked: !!result?.revoked,
      had_token: !!result?.had_token,
      connected: false,
      email: user.email || null,
    });
  } catch (err) { next(err); }
});

// POST /gmail/import — trigger email import for authenticated user
router.post('/import', authenticate, aiEndpoints, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const token = await OAuthToken.findByUserId(user.id);
    if (!token) return res.status(403).json({ error: 'Gmail not connected. Visit GET /gmail/auth first.' });
    await OAuthToken.markSyncAttempt(user.id, { source: 'manual' });
    const result = await importForUser(user);
    await OAuthToken.markSynced(user.id, { source: 'manual' });
    res.json(result);
  } catch (err) {
    const classified = classifyGmailImportError(err);
    const user = req.userId ? await User.findByProviderUid(req.userId) : null;
    if (user?.id) {
      await OAuthToken.markSyncFailure(user.id, {
        source: 'manual',
        error: sanitizeErrorDetail(err) || classified.message,
      });
    }
    console.error('[gmail import] top-level failure:', {
      user_id: user?.id || null,
      status: classified.status,
      error: sanitizeErrorDetail(err),
    });
    res.status(classified.status).json({ error: classified.message });
  }
});

// GET /gmail/import-summary — aggregate recent import outcomes for the authenticated user
router.get('/import-summary', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
    const senderLimit = Math.min(parseInt(req.query.sender_limit, 10) || 5, 20);
    const summary = await getGmailImportQualitySummary(user.id, days, senderLimit);
    const token = await OAuthToken.findByUserId(user.id);
    res.json({
      ...summary,
      last_synced_at: token?.last_synced_at || null,
      last_sync_attempted_at: token?.last_sync_attempted_at || null,
      last_sync_error_at: token?.last_sync_error_at || null,
      last_sync_error: token?.last_sync_error || null,
      last_sync_source: token?.last_sync_source || null,
      last_sync_status: token?.last_sync_status || null,
    });
  } catch (err) { next(err); }
});

// GET /gmail/import-log — recent import log for the authenticated user
router.get('/import-log', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = await EmailImportLog.listByUser(user.id, limit);
    res.json(logs);
  } catch (err) { next(err); }
});

router.post('/import-log/:id/retry', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const log = await EmailImportLog.findByIdForUser(req.params.id, user.id);
    if (!log) return res.status(404).json({ error: 'Import log not found' });
    if (log.status !== 'failed') return res.status(400).json({ error: 'Only failed imports can be retried' });
    const result = await retryFailedImportLog(user, log);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/retry-failed', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 10, 50));
    const result = await retryFailedImportsForUser(user, { limit });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/import-log/:id/feedback', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const feedback = `${req.body?.feedback || ''}`.trim();
    if (!['should_have_imported', 'didnt_need_review', 'needed_more_review'].includes(feedback)) {
      return res.status(400).json({ error: 'Invalid feedback' });
    }
    const log = await EmailImportLog.recordLogFeedback(req.params.id, user.id, feedback);
    if (!log) return res.status(404).json({ error: 'Import log not found' });
    res.json(log);
  } catch (err) { next(err); }
});

router.post('/sender-preferences', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const senderDomain = `${req.body?.sender_domain || ''}`.trim().toLowerCase();
    if (!senderDomain) return res.status(400).json({ error: 'sender_domain required' });
    const preference = await GmailSenderPreference.upsert(user.id, senderDomain, {
      forceReview: !!req.body?.force_review,
    });
    res.json(preference);
  } catch (err) { next(err); }
});

module.exports = router;
