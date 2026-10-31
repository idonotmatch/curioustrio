const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const PushToken = require('../models/pushToken');
const { sendNotifications } = require('../services/pushService');
const RecurringExpense = require('../models/recurringExpense');
const NotificationDelivery = require('../models/notificationDelivery');
const { pushNotificationsEnabled } = require('../services/pushPreferences');
const { safePushData } = require('../services/pushEligibility');
const { isQuietTime, validTimezone } = require('../services/notificationTiming');

const EXPO_PUSH_TOKEN_PATTERN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;

function validExpoPushToken(value) {
  const token = `${value || ''}`.trim();
  return token.length <= 256 && EXPO_PUSH_TOKEN_PATTERN.test(token) ? token : null;
}

router.post('/register', authenticate, async (req, res, next) => {
  try {
    const { token, platform, timezone } = req.body || {};
    const normalizedToken = validExpoPushToken(token);
    if (!normalizedToken || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'valid Expo token and platform required' });
    }
    const normalizedTimezone = timezone === undefined ? null : validTimezone(timezone);
    if (timezone !== undefined && !normalizedTimezone) {
      return res.status(400).json({ error: 'timezone must be a valid IANA timezone' });
    }
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    await PushToken.upsert({ userId: user.id, token: normalizedToken, platform });
    if (normalizedTimezone && normalizedTimezone !== user.notification_timezone) {
      await User.updateNotificationTimezone(user.id, normalizedTimezone);
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/unregister', authenticate, async (req, res, next) => {
  try {
    const token = validExpoPushToken(req.body?.token);
    if (!token) return res.status(400).json({ error: 'valid Expo token required' });
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    await PushToken.removeForUserToken(user.id, token);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/notify-pending', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    if (!pushNotificationsEnabled(user, 'push_recurring_enabled')) return res.json({ sent: 0 });
    if (isQuietTime(user)) return res.json({ sent: 0, skipped: 'quiet_hours' });

    const tokens = await PushToken.findByUser(user.id);
    if (!tokens.length) return res.json({ sent: 0 });

    const due = await RecurringExpense.findDue(user.household_id, 3);
    if (!due.length) return res.json({ sent: 0 });

    const notificationKey = `recurring_due:${due.map((item) => item.id).sort().join(',')}`;
    if (await NotificationDelivery.hasAcceptedKey(user.id, 'recurring', notificationKey)) {
      return res.json({ sent: 0, skipped: 'already_notified' });
    }

    const messages = tokens.map(t => ({
      to: t.token,
      pushTokenId: t.id,
      title: due.length === 1 ? 'A recurring expense is coming up' : `${due.length} recurring expenses are coming up`,
      body: 'Open Adlo to review what may be due soon.',
      data: safePushData({ type: 'recurring', route: '/watching-plans', count: due.length }),
    }));

    const result = await sendNotifications(messages, {
      userId: user.id,
      category: 'recurring',
      notificationKey,
      metadata: { due_count: due.length },
    });
    res.json({ sent: result.accepted, rejected: result.rejected });
  } catch (err) { next(err); }
});

module.exports = router;
