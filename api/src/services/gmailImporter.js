const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const ExpenseItem = require('../models/expenseItem');
const PushToken = require('../models/pushToken');
const { listRecentMessages, getMessage } = require('./gmailClient');
const { classifyEmailExpense, parseEmailExpense } = require('./emailParser');
const { assignCategory } = require('./categoryAssigner');
const { resolveProduct } = require('./productResolver');
const { sendNotifications } = require('./pushService');

function guessMerchant(subject = '', fromAddress = '') {
  const fromMatch = fromAddress.match(/@([a-z0-9-]+)\./i);
  if (fromMatch?.[1]) {
    return fromMatch[1]
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  const subjectMatch = subject.match(/^([^:-]{3,40})/);
  return subjectMatch ? subjectMatch[1].trim() : 'Email import';
}

function findLikelyAmount(body = '') {
  const patterns = [
    /(?:order total|total charged|amount charged|amount paid|payment total|grand total|refund total)[^$\d]{0,20}\$?\s?(-?\d+(?:\.\d{2})?)/i,
    /\btotal\b[^$\d]{0,20}\$?\s?(-?\d+(?:\.\d{2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return Number(match[1]);
  }
  const allMoney = [...body.matchAll(/\$\s?(-?\d+(?:\.\d{2})?)/g)];
  if (allMoney.length > 0) return Number(allMoney[allMoney.length - 1][1]);
  return null;
}

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

    let msgSubject, msgFrom;
    try {
      const { subject, from, body } = await getMessage(user.id, msg.id);
      msgSubject = subject;
      msgFrom = from;
      const classification = await classifyEmailExpense(body, subject, from, todayDate);

      if (classification.disposition === 'not_expense') {
        await EmailImportLog.create({
          userId: user.id, messageId: msg.id, status: 'skipped',
          subject, fromAddress: from, skipReason: classification.reason || 'classifier_not_expense',
        });
        skipped++;
        continue;
      }

      let parsed = await parseEmailExpense(body, subject, from, todayDate);

      if (!parsed) {
        const fallbackAmount = findLikelyAmount(body);
        if (!fallbackAmount) {
          await EmailImportLog.create({
            userId: user.id, messageId: msg.id, status: 'skipped',
            subject, fromAddress: from, skipReason: classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount',
          });
          skipped++;
          continue;
        }
        const fallbackExpense = {
          merchant: classification.merchant || guessMerchant(subject, from),
          amount: classification.disposition === 'refund' ? -Math.abs(fallbackAmount) : Math.abs(fallbackAmount),
          date: todayDate,
          notes: 'Imported from Gmail — needs review',
          items: null,
        };
        parsed = fallbackExpense;
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
        const itemsWithProducts = await Promise.all(
          parsed.items.filter(it => it.description).map(async (item) => {
            const product_id = await resolveProduct(item, parsed.merchant);
            return { ...item, product_id };
          })
        );
        await ExpenseItem.replaceItems(expense.id, itemsWithProducts);
      }

      await EmailImportLog.create({
        userId: user.id,
        messageId: msg.id,
        expenseId: expense.id,
        status: 'imported',
        subject: msgSubject,
        fromAddress: msgFrom,
      });
      imported++;
    } catch (e) {
      console.error(`[gmail import] user=${user.id} msg=${msg.id}:`, e.message);
      await EmailImportLog.create({
        userId: user.id, messageId: msg.id, status: 'failed',
        subject: msgSubject, fromAddress: msgFrom, skipReason: e.message,
      });
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
