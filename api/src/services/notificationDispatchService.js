const db = require('../db');
const BackgroundJob = require('../models/backgroundJob');
const NotificationDelivery = require('../models/notificationDelivery');
const PushToken = require('../models/pushToken');
const User = require('../models/user');
const { sendNotifications } = require('./pushService');
const { safePushData } = require('./pushEligibility');
const { pushNotificationsEnabled } = require('./pushPreferences');
const { isQuietTime, nextNonQuietDate } = require('./notificationTiming');

const GMAIL_REVIEW_COOLDOWN_MS = 2 * 60 * 60 * 1000;

function buildGmailReviewPushPayload(totalPending, newPending = totalPending) {
  const total = Math.max(0, Number(totalPending || 0));
  const fresh = Math.max(0, Math.min(total, Number(newPending || 0)));
  return {
    title: total === 1 ? '1 purchase needs review' : `${total} purchases need review`,
    body: fresh > 0 && fresh < total
      ? `${fresh} ${fresh === 1 ? 'is' : 'are'} new. Open Adlo when you are ready to confirm them.`
      : 'Open Adlo when you are ready to confirm what belongs in your spending history.',
    data: {
      type: 'review_queue',
      route: '/review-queue',
      review_count: total,
      new_review_count: fresh,
    },
  };
}

async function gmailQueueSnapshot(userId, lastNotifiedAt = null) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE $2::timestamptz IS NULL OR created_at > $2::timestamptz
            )::int AS new_count,
            MAX(created_at) AS newest_at
     FROM expenses
     WHERE user_id = $1 AND status = 'pending'`,
    [userId, lastNotifiedAt]
  );
  return {
    total: Number(result.rows[0]?.total || 0),
    newCount: Number(result.rows[0]?.new_count || 0),
    newestAt: result.rows[0]?.newest_at || null,
  };
}

async function enqueueDeferredGmailPush(user, availableAt) {
  const delayMs = Math.max(1000, availableAt.getTime() - Date.now());
  await BackgroundJob.enqueue({
    jobType: BackgroundJob.JOB_TYPES.pushDispatch,
    dedupeKey: `gmail_review:${user.id}`,
    payload: { user_id: user.id, category: 'gmail_review' },
    delayMs,
    maxAttempts: 5,
  });
  return { sent: 0, deferred: true, available_at: availableAt.toISOString() };
}

async function dispatchGmailReviewPush({ userId, now = new Date(), fromJob = false } = {}) {
  const user = await User.findById(userId);
  if (!user || !pushNotificationsEnabled(user, 'push_gmail_review_enabled')) {
    return { sent: 0, skipped: 'preference_disabled' };
  }

  const tokens = await PushToken.findByUser(user.id);
  if (!tokens.length) return { sent: 0, skipped: 'no_tokens' };

  const lastAcceptedAt = await NotificationDelivery.latestAcceptedAt(user.id, 'gmail_review');
  const snapshot = await gmailQueueSnapshot(user.id, lastAcceptedAt);
  if (!snapshot.total || !snapshot.newCount) return { sent: 0, skipped: 'nothing_new' };

  const quietUntil = isQuietTime(user, now) ? nextNonQuietDate(user, now) : now;
  const cooldownUntil = lastAcceptedAt
    ? new Date(new Date(lastAcceptedAt).getTime() + GMAIL_REVIEW_COOLDOWN_MS)
    : now;
  const availableAt = new Date(Math.max(now.getTime(), quietUntil.getTime(), cooldownUntil.getTime()));
  if (availableAt.getTime() > now.getTime() + 1000) {
    return enqueueDeferredGmailPush(user, availableAt);
  }

  const notificationKey = `gmail_review:${new Date(snapshot.newestAt).toISOString()}:${snapshot.total}`;
  if (await NotificationDelivery.hasAcceptedKey(user.id, 'gmail_review', notificationKey)) {
    return { sent: 0, skipped: 'already_notified' };
  }

  const notification = buildGmailReviewPushPayload(snapshot.total, snapshot.newCount);
  const result = await sendNotifications(tokens.map((token) => ({
    to: token.token,
    pushTokenId: token.id,
    title: notification.title,
    body: notification.body,
    data: safePushData(notification.data),
  })), {
    userId: user.id,
    category: 'gmail_review',
    notificationKey,
    metadata: { total_pending: snapshot.total, new_pending: snapshot.newCount },
  });

  const transientFailure = result.accepted === 0 && result.results?.some((item) => (
    item?.error?.code !== 'DeviceNotRegistered'
  ));
  if (transientFailure) {
    if (fromJob) {
      const error = new Error('Gmail review push delivery was not accepted by Expo');
      error.code = 'push_delivery_rejected';
      throw error;
    }
    const retryAt = new Date(now.getTime() + 5 * 60 * 1000);
    const deferred = await enqueueDeferredGmailPush(user, retryAt);
    return { ...deferred, rejected: result.rejected, retry_reason: 'delivery_rejected' };
  }

  return { sent: result.accepted, rejected: result.rejected, deferred: false };
}

async function runDeferredPushDispatch(payload = {}) {
  if (payload.category === 'gmail_review') {
    return dispatchGmailReviewPush({ userId: payload.user_id, fromJob: true });
  }
  return { sent: 0, skipped: 'unsupported_category' };
}

module.exports = {
  buildGmailReviewPushPayload,
  dispatchGmailReviewPush,
  gmailQueueSnapshot,
  runDeferredPushDispatch,
};
