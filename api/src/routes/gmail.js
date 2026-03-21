const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const OAuthToken = require('../models/oauthToken');
const EmailImportLog = require('../models/emailImportLog');
const { getAuthUrl, exchangeCode, listRecentMessages, getMessage } = require('../services/gmailClient');
const { parseEmailExpense } = require('../services/emailParser');
const { assignCategory } = require('../services/categoryAssigner');

// GET /gmail/auth — redirect to Google OAuth
router.get('/auth', authenticate, (req, res) => {
  res.redirect(getAuthUrl());
});

// GET /gmail/callback — exchange code, save token
router.get('/callback', authenticate, async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const user = await User.findByAuth0Id(req.auth0Id);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const tokens = await exchangeCode(code);
    await OAuthToken.upsert({ userId: user.id, ...tokens });
    res.json({ connected: true });
  } catch (err) { next(err); }
});

// GET /gmail/status — is Gmail connected?
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByAuth0Id(req.auth0Id);
    if (!user) return res.status(401).json({ error: 'User not synced' });
    const token = await OAuthToken.findByUserId(user.id);
    res.json({ connected: !!token });
  } catch (err) { next(err); }
});

// POST /gmail/import — trigger email import for authenticated user
router.post('/import', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByAuth0Id(req.auth0Id);
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
          await EmailImportLog.create({ userId: user.id, messageId: msg.id, subject, fromAddress: from, status: 'skipped' });
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
          subject,
          fromAddress: from,
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
