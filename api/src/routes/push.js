const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const PushToken = require('../models/pushToken');
const { sendNotifications } = require('../services/pushService');
const RecurringExpense = require('../models/recurringExpense');
const { pushNotificationsEnabled } = require('../services/pushPreferences');

router.post('/register', authenticate, async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token || !platform) return res.status(400).json({ error: 'token and platform required' });
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    await PushToken.upsert({ userId: user.id, token, platform });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/notify-pending', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });
    if (!pushNotificationsEnabled(user, 'push_recurring_enabled')) return res.json({ sent: 0 });

    const tokens = await PushToken.findByUser(user.id);
    if (!tokens.length) return res.json({ sent: 0 });

    const due = await RecurringExpense.findDue(user.household_id, 3);
    if (!due.length) return res.json({ sent: 0 });

    const messages = tokens.map(t => ({
      to: t.token,
      title: due.length === 1 ? 'A recurring expense is coming up' : `${due.length} recurring expenses are coming up`,
      body: 'Open Adlo to review what may be due soon.',
      data: { type: 'recurring', route: '/watching-plans', count: due.length },
    }));

    await sendNotifications(messages);
    res.json({ sent: messages.length });
  } catch (err) { next(err); }
});

module.exports = router;
