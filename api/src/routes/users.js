const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

function normalizeEmail(value) {
  const email = `${value || ''}`.trim().toLowerCase();
  return email || null;
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    auth_user_id: user.provider_uid,
    name: user.name,
    email: user.email,
    household_id: user.household_id,
    budget_start_day: user.budget_start_day,
    push_gmail_review_enabled: user.push_gmail_review_enabled,
    push_insights_enabled: user.push_insights_enabled,
    push_recurring_enabled: user.push_recurring_enabled,
    created_at: user.created_at,
  };
}

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(serializeUser(user));
  } catch (err) {
    next(err);
  }
});

router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const requestedEmail = normalizeEmail(email);
    const tokenEmail = normalizeEmail(req.auth?.email);

    if (requestedEmail && tokenEmail && requestedEmail !== tokenEmail) {
      return res.status(403).json({ error: 'email does not match the authenticated user' });
    }

    if (requestedEmail && !tokenEmail) {
      return res.status(400).json({ error: 'authenticated token must include email to sync by email' });
    }

    const trustedEmail = tokenEmail || null;

    if (trustedEmail) {
      // Email-based linking is allowed only from the authenticated token, never
      // from a caller-supplied body value alone.
      const existingByEmail = await User.findByEmail(trustedEmail);
      if (existingByEmail) {
        const updated = await User.updateProviderUid(existingByEmail.id, req.userId);
        return res.json(serializeUser(updated));
      }
      const existingByUid = await User.findByProviderUid(req.userId);
      if (existingByUid) return res.json(serializeUser(existingByUid));
      const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email: trustedEmail });
      return res.json(serializeUser(created));
    }

    const existing = await User.findByProviderUid(req.userId);
    if (existing) return res.json(serializeUser(existing));
    const created = await User.findOrCreateByProviderUid({ providerUid: req.userId, name, email: null });
    return res.json(serializeUser(created));
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
      return res.json(serializeUser(updated));
    }

    return res.json(serializeUser(user));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
