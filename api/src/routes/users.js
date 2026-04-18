const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    if (email) {
      // Email provided: check for existing user by email (migration path from Auth0)
      const existingByEmail = await User.findByEmail(email);
      if (existingByEmail) {
        const updated = await User.updateProviderUid(existingByEmail.id, req.userId);
        return res.json(updated);
      }
      // No email match — check by provider_uid, then create
      const existingByUid = await User.findByProviderUid(req.userId);
      if (existingByUid) return res.json(existingByUid);
      const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email });
      return res.json(created);
    } else {
      // No email (Apple re-auth after first sign-in)
      const existing = await User.findByProviderUid(req.userId);
      if (existing) return res.json(existing);
      const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email: null });
      return res.json(created);
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/settings', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const {
      budget_start_day,
      push_gmail_review_enabled,
      push_insights_enabled,
      push_recurring_enabled,
    } = req.body || {};

    if (budget_start_day !== undefined) {
      const day = parseInt(budget_start_day, 10);
      if (isNaN(day) || day < 1 || day > 28) {
        return res.status(400).json({ error: 'budget_start_day must be between 1 and 28' });
      }
    }

    const booleanFields = [
      ['push_gmail_review_enabled', push_gmail_review_enabled],
      ['push_insights_enabled', push_insights_enabled],
      ['push_recurring_enabled', push_recurring_enabled],
    ];
    for (const [field, value] of booleanFields) {
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({ error: `${field} must be a boolean` });
      }
    }

    if (
      budget_start_day !== undefined
      || push_gmail_review_enabled !== undefined
      || push_insights_enabled !== undefined
      || push_recurring_enabled !== undefined
    ) {
      const updated = await User.updateSettings(user.id, {
        budgetStartDay: budget_start_day !== undefined ? parseInt(budget_start_day, 10) : undefined,
        pushGmailReviewEnabled: push_gmail_review_enabled,
        pushInsightsEnabled: push_insights_enabled,
        pushRecurringEnabled: push_recurring_enabled,
      });
      return res.json(updated);
    }

    return res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
