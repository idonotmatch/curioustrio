const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../db');
const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const OAuthToken = require('../models/oauthToken');
const EmailImportLog = require('../models/emailImportLog');
const { getAuthUrl, exchangeCode, listRecentMessages, getMessage } = require('../services/gmailClient');
const { parseEmailExpense } = require('../services/emailParser');
const { assignCategory } = require('../services/categoryAssigner');

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
    res.send('<html><body><h2>Gmail connected!</h2><p>You can close this tab.</p></body></html>');
  } catch (err) { next(err); }
});

// GET /gmail/status — is Gmail connected?
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const token = await OAuthToken.findByUserId(user.id);
    res.json({ connected: !!token });
  } catch (err) { next(err); }
});

// POST /gmail/import — trigger email import for authenticated user
router.post('/import', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const token = await OAuthToken.findByUserId(user.id);
    if (!token) return res.status(403).json({ error: 'Gmail not connected. Visit GET /gmail/auth first.' });

    const messages = await listRecentMessages(user.id);
    const categories = await Category.findByHousehold(user.household_id);
    const todayDate = new Date().toISOString().split('T')[0];

    let imported = 0, skipped = 0, failed = 0;

    for (const msg of messages) {
      const existing = await EmailImportLog.findByMessageId(user.id, msg.id);
      if (existing) { skipped++; continue; }

      try {
        const { subject, from, body } = await getMessage(user.id, msg.id);
        const parsed = await parseEmailExpense(body, subject, from, todayDate);

        if (!parsed) {
          await EmailImportLog.create({ userId: user.id, messageId: msg.id, status: 'skipped' });
          skipped++;
          continue;
        }

        const { category_id } = await assignCategory({
          merchant: parsed.merchant,
          householdId: user.household_id,
          categories,
        });

        const expense = await Expense.create({
          userId: user.id,
          householdId: user.household_id,
          merchant: parsed.merchant,
          amount: parsed.amount,
          date: parsed.date,
          categoryId: category_id,
          source: 'email',
          status: 'pending',
          notes: parsed.notes,
        });

        await EmailImportLog.create({
          userId: user.id,
          messageId: msg.id,
          expenseId: expense.id,
          status: 'imported',
        });
        imported++;
      } catch (e) {
        await EmailImportLog.create({ userId: user.id, messageId: msg.id, status: 'failed' });
        failed++;
      }
    }

    res.json({ imported, skipped, failed });
  } catch (err) { next(err); }
});

module.exports = router;
