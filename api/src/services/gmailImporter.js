const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const ExpenseItem = require('../models/expenseItem');
const PushToken = require('../models/pushToken');
const { listRecentMessages, getMessage } = require('./gmailClient');
const {
  classifyEmailExpense,
  parseEmailExpense,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
} = require('./emailParser');
const { assignCategory } = require('./categoryAssigner');
const { resolveProduct } = require('./productResolver');
const { sendNotifications } = require('./pushService');
const { searchPlace } = require('./mapkitService');
const { getSenderImportQuality } = require('./gmailImportQualityService');

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

function buildReviewNotes({ subject = '', snippet = '', body = '', reason = 'needs review' }) {
  const cleanedSubject = (subject || '').trim();
  const cleanedSnippet = (snippet || '').replace(/\s+/g, ' ').trim();
  const fallbackDetail = cleanedSnippet
    || body
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);

  const context = [cleanedSubject, fallbackDetail]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 220);

  return context
    ? `${context} (${reason})`
    : `Imported from Gmail (${reason})`;
}

async function resolveEmailLocation({ merchant = '', subject = '', from = '', body = '' }) {
  const modality = classifyEmailModality(subject, from, body);
  if (!['in_person', 'pickup'].includes(modality)) {
    return { modality, location: null };
  }

  const candidate = extractEmailLocationCandidate(subject, from, body);
  const queryParts = [
    merchant && merchant.trim(),
    candidate?.store_number ? `Store ${candidate.store_number}` : null,
    candidate?.address,
    candidate?.city_state && !candidate?.address?.includes(candidate.city_state) ? candidate.city_state : null,
  ].filter(Boolean);

  if (!queryParts.length) {
    return { modality, location: null };
  }

  try {
    const location = await searchPlace(queryParts.join(' '));
    return { modality, location };
  } catch {
    return { modality, location: null };
  }
}

/**
 * Run a Gmail import for a single user.
 * Returns { imported, skipped, failed, outcomes }.
 * All errors are caught per-message — a bad email never aborts the run.
 */
async function importForUser(user) {
  const messages = await listRecentMessages(user.id);
  const categories = await Category.findByHousehold(user.household_id);
  const todayDate = new Date().toISOString().split('T')[0];

  let imported = 0, skipped = 0, failed = 0;
  const outcomes = {
    imported_parsed: 0,
    imported_pending_review: 0,
    skipped_existing: 0,
    skipped_reasons: {},
    failed_reasons: {},
  };

  function increment(bucket, key) {
    bucket[key] = (bucket[key] || 0) + 1;
  }

  for (const msg of messages) {
    const existing = await EmailImportLog.findByMessageId(user.id, msg.id);
    if (existing) {
      skipped++;
      outcomes.skipped_existing++;
      continue;
    }

    let msgSubject, msgFrom;
    try {
      const { subject, from, body, snippet, receivedAt } = await getMessage(user.id, msg.id);
      msgSubject = subject;
      msgFrom = from;
      const senderQuality = await getSenderImportQuality(user.id, from);
      const classification = await classifyEmailExpense(body, subject, from, todayDate, snippet);
      const signals = analyzeEmailSignals(subject, from, body);

      if (classification.disposition === 'not_expense') {
        if (signals.shouldSurfaceToReview) {
          classification.disposition = 'uncertain';
        } else {
        const skipReason = classification.reason || 'classifier_not_expense';
        await EmailImportLog.create({
          userId: user.id, messageId: msg.id, status: 'skipped',
          subject, fromAddress: from, skipReason,
        });
        skipped++;
        increment(outcomes.skipped_reasons, skipReason);
        continue;
        }
      }

      let parsed = await parseEmailExpense(body, subject, from, todayDate, snippet);
      let importedAsPendingReview = false;
      const maxExpenseDate = receivedAt && receivedAt < todayDate ? receivedAt : todayDate;

      if (!parsed) {
        const fallbackAmount = findLikelyAmount(body);
        if (!fallbackAmount) {
          const skipReason = classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount';
          await EmailImportLog.create({
            userId: user.id, messageId: msg.id, status: 'skipped',
            subject, fromAddress: from, skipReason,
          });
          skipped++;
          increment(outcomes.skipped_reasons, skipReason);
          continue;
        }
        if (senderQuality.level === 'noisy') {
          const skipReason = 'low_sender_quality';
          await EmailImportLog.create({
            userId: user.id, messageId: msg.id, status: 'skipped',
            subject, fromAddress: from, skipReason,
          });
          skipped++;
          increment(outcomes.skipped_reasons, skipReason);
          continue;
        }
        const fallbackExpense = {
          merchant: classification.merchant || guessMerchant(subject, from),
          amount: classification.disposition === 'refund' ? -Math.abs(fallbackAmount) : Math.abs(fallbackAmount),
          date: maxExpenseDate,
          notes: buildReviewNotes({
            subject,
            snippet,
            body,
            reason: 'needs review',
          }),
          items: null,
        };
        parsed = fallbackExpense;
        importedAsPendingReview = true;
      }

      parsed.date = clampExpenseDate(parsed.date, maxExpenseDate);
      if (!parsed.notes || /needs review/i.test(parsed.notes)) {
        parsed.notes = buildReviewNotes({
          subject,
          snippet,
          body,
          reason: importedAsPendingReview ? 'needs review' : 'imported from gmail',
        });
      }
      if (senderQuality.level === 'trusted' && !importedAsPendingReview && /needs review/i.test(parsed.notes || '')) {
        parsed.notes = buildReviewNotes({
          subject,
          snippet,
          body,
          reason: 'imported from gmail',
        });
      }
      if (senderQuality.level === 'noisy' && !/needs review/i.test(parsed.notes || '')) {
        parsed.notes = buildReviewNotes({
          subject,
          snippet,
          body,
          reason: 'needs review',
        });
        importedAsPendingReview = true;
      }

      const duplicateCandidates = await Expense.findPotentialDuplicates({
        householdId: user.household_id,
        merchant: parsed.merchant,
        amount: parsed.amount,
        date: parsed.date,
      });
      if (duplicateCandidates.length > 0) {
        await EmailImportLog.create({
          userId: user.id,
          messageId: msg.id,
          status: 'skipped',
          subject,
          fromAddress: from,
          skipReason: 'duplicate_expense',
        });
        skipped++;
        increment(outcomes.skipped_reasons, 'duplicate_expense');
        continue;
      }

      const { category_id } = await assignCategory({
        merchant: parsed.merchant,
        householdId: user.household_id,
        categories,
      });
      const { location } = await resolveEmailLocation({
        merchant: parsed.merchant,
        subject,
        from,
        body,
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
        placeName: location?.place_name || null,
        address: location?.address || null,
        mapkitStableId: location?.mapkit_stable_id || null,
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
      if (importedAsPendingReview || /needs review/i.test(parsed.notes || '')) {
        outcomes.imported_pending_review++;
      } else {
        outcomes.imported_parsed++;
      }
    } catch (e) {
      console.error(`[gmail import] user=${user.id} msg=${msg.id}:`, e.message);
      increment(outcomes.failed_reasons, e.code || e.message || 'unknown_error');
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

  return { imported, skipped, failed, outcomes };
}

module.exports = { importForUser };
