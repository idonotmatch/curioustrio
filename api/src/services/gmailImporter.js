const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const ExpenseItem = require('../models/expenseItem');
const PushToken = require('../models/pushToken');
const { listRecentMessages, getMessage } = require('./gmailClient');
const { parseEmailExpense } = require('./emailParser');
const { assignCategory } = require('./categoryAssigner');
const { sendNotifications } = require('./pushService');

/**
 * Run a Gmail import for a single user.
 * Returns { imported, skipped, failed }.
 * All errors are caught per-message — a bad email never aborts the run.
 */
async function importForUser(user) {
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
        await EmailImportLog.create({
          userId: user.id, messageId: msg.id, status: 'skipped',
          subject, fromAddress: from, skipReason: 'not_expense',
        });
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

      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        await ExpenseItem.replaceItems(expense.id, parsed.items.filter(it => it.description));
      }

      await EmailImportLog.create({
        userId: user.id,
        messageId: msg.id,
        expenseId: expense.id,
        status: 'imported',
      });
      imported++;
    } catch (e) {
      console.error(`[gmail import] user=${user.id} msg=${msg.id}:`, e.message);
      await EmailImportLog.create({ userId: user.id, messageId: msg.id, status: 'failed' });
      failed++;
    }
  }

  // Send push notification if new expenses were imported
  if (imported > 0) {
    try {
      const tokens = await PushToken.findByUser(user.id);
      if (tokens.length > 0) {
        const body = imported === 1
          ? '1 new expense imported from Gmail'
          : `${imported} new expenses imported from Gmail`;
        await sendNotifications(tokens.map(t => ({
          to: t.token,
          title: 'New expenses',
          body,
          data: { screen: 'pending' },
        })));
      }
    } catch (e) {
      console.error(`[gmail import] push notification failed user=${user.id}:`, e.message);
    }
  }

  return { imported, skipped, failed };
}

module.exports = { importForUser };
