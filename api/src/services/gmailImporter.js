const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const ExpenseItem = require('../models/expenseItem');
const PushToken = require('../models/pushToken');
const db = require('../db');
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
const { resolveProductMatch } = require('./productResolver');
const { sendNotifications } = require('./pushService');
const { searchPlace } = require('./mapkitService');
const { getSenderImportQuality, recommendReviewMode } = require('./gmailImportQualityService');
const { getItemHistoryByGroupKey } = require('./itemHistoryService');
const { pushNotificationsEnabled } = require('./pushPreferences');

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

function findLikelyAmount(...parts) {
  const body = parts
    .filter(Boolean)
    .map((part) => `${part}`)
    .join('\n');
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

function hasValidParsedAmount(parsed) {
  return Number.isFinite(Number(parsed?.amount)) && Number(parsed.amount) !== 0;
}

function createOutcomes() {
  return {
    imported_parsed: 0,
    imported_pending_review: 0,
    imported_auto_confirmed: 0,
    imported_fast_lane: 0,
    imported_items_first: 0,
    imported_full_review: 0,
    skipped_existing: 0,
    skipped_reasons: {},
    failed_reasons: {},
  };
}

function increment(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function buildGmailImportPushPayload(imported, outcomes = {}) {
  const pendingReview = Number(outcomes.imported_pending_review || 0);
  const autoAdded = Math.max(0, Number(imported || 0) - pendingReview);

  if (pendingReview > 0) {
    return {
      title: pendingReview === 1 ? '1 Gmail import needs review' : `${pendingReview} Gmail imports need review`,
      body: pendingReview === 1
        ? 'A new receipt is waiting in your review queue.'
        : `${pendingReview} new receipts are waiting in your review queue.`,
      data: {
        type: 'review_queue',
        route: '/review-queue',
        imported_count: Number(imported || 0),
        review_count: pendingReview,
      },
    };
  }

  return {
    title: autoAdded === 1 ? '1 Gmail expense added' : `${autoAdded} Gmail expenses added`,
    body: autoAdded === 1
      ? 'A new expense was added from Gmail.'
      : `${autoAdded} new expenses were added from Gmail.`,
    data: {
      type: 'gmail_import',
      route: '/(tabs)/index',
      imported_count: Number(imported || 0),
      review_count: 0,
    },
  };
}

function buildReviewNotes({ reason = 'needs review' } = {}) {
  const normalizedReason = `${reason || ''}`.trim().toLowerCase();
  if (!normalizedReason || normalizedReason === 'imported from gmail') {
    return 'Imported from Gmail';
  }
  return `Imported from Gmail (${normalizedReason})`;
}

function summarizeImportFailure(err) {
  const message = `${err?.message || ''}`.toLowerCase();
  if (err?.code) return `${err.code}`.slice(0, 80);
  if (message.includes('invalid_grant') || message.includes('invalid credentials')) return 'gmail_auth_expired';
  if (message.includes('network request failed') || message.includes('fetch failed')) return 'network_error';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('rate limit')) return 'rate_limited';
  if (message.includes('amount')) return 'amount_parse_failed';
  return 'import_failed';
}

function shouldSoftenSkipBehavior(senderQuality = {}) {
  const metrics = senderQuality?.metrics || {};
  return (
    Number(metrics.should_have_imported || 0) >= 1
    || Number(metrics.should_have_imported_rate || 0) >= 0.2
  );
}

function buildItemHistoryReviewAdjustment(expenseLike = {}, itemHistories = []) {
  const contexts = Array.isArray(itemHistories) ? itemHistories : [];
  if (!contexts.length) return null;

  const totalAmount = Math.abs(Number(expenseLike.amount || 0));
  let trustedSignals = 0;
  let cautionSignals = 0;

  for (const context of contexts) {
    const latestPurchase = context.latest_purchase || null;
    const latestMerchant = `${latestPurchase?.merchant || ''}`.trim().toLowerCase();
    const currentMerchant = `${expenseLike.merchant || ''}`.trim().toLowerCase();
    const medianAmount = Number(context.median_amount || 0);
    const deltaPercent = medianAmount > 0
      ? Math.round((Math.abs(totalAmount - medianAmount) / medianAmount) * 100)
      : null;

    if (Number(context.occurrence_count || 0) >= 3) trustedSignals += 1;
    if (medianAmount > 0 && deltaPercent != null && deltaPercent <= 15) trustedSignals += 1;
    if (latestMerchant && currentMerchant && latestMerchant === currentMerchant) trustedSignals += 1;

    if (latestMerchant && currentMerchant && latestMerchant !== currentMerchant) cautionSignals += 1;
    if (medianAmount > 0 && deltaPercent != null && deltaPercent >= 30) cautionSignals += 1;
  }

  if (cautionSignals > 0) {
    return {
      level: 'noisy',
      message: 'Parsed items do not line up cleanly with recent item history.',
    };
  }

  if (trustedSignals >= 2) {
    return {
      level: 'trusted',
      message: 'Parsed items line up with familiar purchase history.',
    };
  }

  return {
    level: 'mixed',
    message: 'Parsed items partially match familiar purchase history.',
  };
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

async function processMessageImport(user, msgId, {
  categories,
  todayDate,
  allowExistingRetry = false,
  existingLog = null,
  outcomes = createOutcomes(),
} = {}) {
  if (!allowExistingRetry) {
    const existing = existingLog || await EmailImportLog.findByMessageId(user.id, msgId);
    if (existing) {
      outcomes.skipped_existing++;
      return { imported: 0, skipped: 1, failed: 0, reason: 'existing' };
    }
  }

  let msgSubject, msgFrom, msgSnippet;
  try {
    const { subject, from, body, snippet, receivedAt } = await getMessage(user.id, msgId);
    msgSubject = subject;
    msgFrom = from;
    msgSnippet = snippet;
    const messageDateContext = receivedAt && /^\d{4}-\d{2}-\d{2}$/.test(receivedAt) ? receivedAt : todayDate;
    const senderQuality = await getSenderImportQuality(user.id, from, subject);
    const softenSkipBehavior = shouldSoftenSkipBehavior(senderQuality);
    const templateQuality = senderQuality?.template_quality || {};
    const classification = await classifyEmailExpense(body, subject, from, messageDateContext, snippet);
    const signals = analyzeEmailSignals(subject, from, body);

    if (
      templateQuality.should_skip_prequeue
      && !signals.shouldSurfaceToReview
      && !signals.strongMoneySignal
      && !signals.mediumMoneySignal
    ) {
      const skipReason = `template_skip_${templateQuality.subject_pattern || 'non_transactional'}`;
      await EmailImportLog.upsertResult({
        userId: user.id, messageId: msgId, status: 'skipped',
        subject, fromAddress: from, skipReason, snippet,
      });
      increment(outcomes.skipped_reasons, skipReason);
      return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
    }

    if (classification.disposition === 'not_expense') {
      if (signals.shouldSurfaceToReview || softenSkipBehavior || templateQuality.force_import_review) {
        classification.disposition = 'uncertain';
      } else {
        const skipReason = classification.reason || 'classifier_not_expense';
        await EmailImportLog.upsertResult({
          userId: user.id, messageId: msgId, status: 'skipped',
          subject, fromAddress: from, skipReason, snippet,
        });
        increment(outcomes.skipped_reasons, skipReason);
        return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
      }
    }

    let parsed = await parseEmailExpense(body, subject, from, messageDateContext, snippet);
    let importedAsPendingReview = false;
    const maxExpenseDate = messageDateContext < todayDate ? messageDateContext : todayDate;

    if (!parsed || !hasValidParsedAmount(parsed)) {
      const fallbackAmount = findLikelyAmount(subject, snippet, body);
      if (!fallbackAmount) {
        const skipReason = classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount';
        await EmailImportLog.upsertResult({
          userId: user.id, messageId: msgId, status: 'skipped',
          subject, fromAddress: from, skipReason, snippet,
        });
        increment(outcomes.skipped_reasons, skipReason);
        return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
      }
      if (senderQuality.level === 'noisy' && !softenSkipBehavior) {
        const skipReason = 'low_sender_quality';
        await EmailImportLog.upsertResult({
          userId: user.id, messageId: msgId, status: 'skipped',
          subject, fromAddress: from, skipReason, snippet,
        });
        increment(outcomes.skipped_reasons, skipReason);
        return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
      }
      parsed = {
        ...parsed,
        merchant: parsed?.merchant || classification.merchant || guessMerchant(subject, from),
        amount: classification.disposition === 'refund' ? -Math.abs(fallbackAmount) : Math.abs(fallbackAmount),
        date: clampExpenseDate(parsed?.date, maxExpenseDate),
        notes: parsed?.notes || buildReviewNotes({ reason: 'needs review' }),
        items: Array.isArray(parsed?.items) ? parsed.items : null,
      };
      importedAsPendingReview = true;
    }

    parsed.date = clampExpenseDate(parsed.date, maxExpenseDate);
    if (!hasValidParsedAmount(parsed)) {
      const skipReason = classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount';
      await EmailImportLog.upsertResult({
        userId: user.id, messageId: msgId, status: 'skipped',
        subject, fromAddress: from, skipReason, snippet,
      });
      increment(outcomes.skipped_reasons, skipReason);
      return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
    }
    if (!parsed.notes || /needs review/i.test(parsed.notes)) {
      parsed.notes = buildReviewNotes({
        reason: importedAsPendingReview ? 'needs review' : 'imported from gmail',
      });
    }
    if (senderQuality.level === 'noisy' && !/needs review/i.test(parsed.notes || '')) {
      parsed.notes = buildReviewNotes({ reason: 'needs review' });
      importedAsPendingReview = true;
    }

    const duplicateCandidates = await Expense.findPotentialDuplicates({
      householdId: user.household_id,
      merchant: parsed.merchant,
      amount: parsed.amount,
      date: parsed.date,
    });
    if (duplicateCandidates.length > 0) {
      await EmailImportLog.upsertResult({
        userId: user.id,
        messageId: msgId,
        status: 'skipped',
        subject,
        fromAddress: from,
        skipReason: 'duplicate_expense',
        snippet,
      });
      increment(outcomes.skipped_reasons, 'duplicate_expense');
      return { imported: 0, skipped: 1, failed: 0, reason: 'duplicate_expense' };
    }

    const categoryAssignment = await assignCategory({
      merchant: parsed.merchant,
      description: parsed.description,
      householdId: user.household_id,
      categories,
    });
    const { category_id } = categoryAssignment;
    const { location } = await resolveEmailLocation({ merchant: parsed.merchant, subject, from, body });
    let itemsWithProducts = [];
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      itemsWithProducts = await Promise.all(
        parsed.items.filter(it => it.description).map(async (item) => {
          const resolution = await resolveProductMatch(item, parsed.merchant);
          return {
            ...item,
            product_id: resolution?.confidence === 'high' ? resolution.product_id : null,
            product_match_confidence: resolution?.confidence || null,
            product_match_reason: resolution?.reason || null,
          };
        })
      );
    }

    let effectiveSenderQuality = senderQuality;
    if (itemsWithProducts.length > 0) {
      const uniqueGroupKeys = [...new Set(itemsWithProducts
        .map((item) => item.product_id ? `product:${item.product_id}` : (item.comparable_key ? `comparable:${item.comparable_key}` : null))
        .filter(Boolean))]
        .slice(0, 2);
      if (uniqueGroupKeys.length > 0) {
        const histories = await Promise.all(
          uniqueGroupKeys.map((groupKey) => getItemHistoryByGroupKey(user.id, groupKey, { scope: 'personal', lookbackDays: 180 }))
        );
        const adjustment = buildItemHistoryReviewAdjustment(parsed, histories.filter(Boolean));
        if (adjustment?.level) {
          effectiveSenderQuality = {
            ...senderQuality,
            item_reliability: {
              ...(senderQuality.item_reliability || {}),
              level: adjustment.level,
              message: adjustment.message,
            },
          };
        }
      }
    }

    const reviewMode = recommendReviewMode(effectiveSenderQuality);

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
      paymentMethod: parsed.payment_method || 'unknown',
      cardLast4: parsed.card_last4 || null,
      cardLabel: parsed.card_label || null,
      categorySource: categoryAssignment.source || null,
      categoryConfidence: categoryAssignment.confidence ?? null,
      categoryReasoning: categoryAssignment.reasoning || null,
      reviewRequired: true,
      reviewMode: reviewMode || null,
      reviewSource: 'gmail',
    });

    if (itemsWithProducts.length > 0) {
      await ExpenseItem.replaceItems(expense.id, itemsWithProducts);
    }

    await EmailImportLog.upsertResult({
      userId: user.id,
      messageId: msgId,
      expenseId: expense.id,
      status: 'imported',
      subject: msgSubject,
      fromAddress: msgFrom,
      snippet: msgSnippet,
    });

    if (reviewMode === 'quick_check') {
      outcomes.imported_fast_lane++;
    } else if (reviewMode === 'items_first') {
      outcomes.imported_items_first++;
    } else {
      outcomes.imported_full_review++;
    }
    outcomes.imported_pending_review++;
    return { imported: 1, skipped: 0, failed: 0, expense };
  } catch (e) {
    const failureReason = summarizeImportFailure(e);
    console.error('[gmail import] message failed', {
      user_id: user.id,
      message_id: msgId,
      reason: failureReason,
    });
    increment(outcomes.failed_reasons, failureReason);
    await EmailImportLog.upsertResult({
      userId: user.id, messageId: msgId, status: 'failed',
      subject: msgSubject, fromAddress: msgFrom, skipReason: failureReason, snippet: msgSnippet,
    });
    return { imported: 0, skipped: 0, failed: 1, error: e };
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
  const outcomes = createOutcomes();

  for (const msg of messages) {
    const result = await processMessageImport(user, msg.id, { categories, todayDate, outcomes });
    imported += result.imported;
    skipped += result.skipped;
    failed += result.failed;
  }

  // Send push notification if new expenses were imported
  if (imported > 0) {
    try {
      const notification = buildGmailImportPushPayload(imported, outcomes);
      const shouldSend = notification.data?.review_count > 0
        ? pushNotificationsEnabled(user, 'push_gmail_review_enabled')
        : pushNotificationsEnabled(user, 'push_gmail_review_enabled');
      if (shouldSend) {
        const tokens = await PushToken.findByUser(user.id);
        if (tokens.length > 0) {
          await sendNotifications(tokens.map(t => ({
            to: t.token,
            title: notification.title,
            body: notification.body,
            data: notification.data,
          })));
        }
      }
    } catch (e) {
      console.error('[gmail import] push notification failed', {
        user_id: user.id,
        reason: summarizeImportFailure(e),
      });
    }
  }

  return { imported, skipped, failed, outcomes };
}

async function retryFailedImportLog(user, log) {
  const categories = await Category.findByHousehold(user.household_id);
  const todayDate = new Date().toISOString().split('T')[0];
  const outcomes = createOutcomes();
  return processMessageImport(user, log.message_id, {
    categories,
    todayDate,
    allowExistingRetry: true,
    existingLog: log,
    outcomes,
  });
}

async function removePendingImportedExpense(expenseId, userId) {
  if (!expenseId || !userId) return;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE expenses SET linked_expense_id = NULL WHERE linked_expense_id = $1`, [expenseId]);
    await client.query(`UPDATE email_import_log SET expense_id = NULL WHERE expense_id = $1`, [expenseId]);
    await client.query(`DELETE FROM duplicate_flags WHERE expense_id_a = $1 OR expense_id_b = $1`, [expenseId]);
    await client.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
    await client.query(`DELETE FROM recurring_preferences WHERE expense_id = $1`, [expenseId]);
    await client.query(`DELETE FROM expenses WHERE id = $1 AND user_id = $2`, [expenseId, userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function reprocessImportLog(user, log) {
  const categories = await Category.findByHousehold(user.household_id);
  const todayDate = new Date().toISOString().split('T')[0];
  const outcomes = createOutcomes();

  if (log?.expense_id) {
    const existingExpense = await Expense.findById(log.expense_id);
    if (existingExpense) {
      if (existingExpense.user_id !== user.id) {
        throw new Error('Import log does not belong to this user');
      }
      if (existingExpense.source !== 'email') {
        throw new Error('Only Gmail-imported expenses can be reprocessed');
      }
      if (existingExpense.status !== 'pending') {
        throw new Error('Only pending Gmail imports can be reprocessed');
      }
      await removePendingImportedExpense(existingExpense.id, user.id);
    }
  }

  return processMessageImport(user, log.message_id, {
    categories,
    todayDate,
    allowExistingRetry: true,
    existingLog: log,
    outcomes,
  });
}

async function retryFailedImportsForUser(user, { limit = 10 } = {}) {
  const failedLogs = await EmailImportLog.listFailedByUser(user.id, limit);
  let imported = 0, skipped = 0, failed = 0;
  const outcomes = createOutcomes();

  const categories = await Category.findByHousehold(user.household_id);
  const todayDate = new Date().toISOString().split('T')[0];
  for (const log of failedLogs) {
    const result = await processMessageImport(user, log.message_id, {
      categories,
      todayDate,
      allowExistingRetry: true,
      existingLog: log,
      outcomes,
    });
    imported += result.imported;
    skipped += result.skipped;
    failed += result.failed;
  }
  return { imported, skipped, failed, outcomes, attempted: failedLogs.length };
}

module.exports = {
  importForUser,
  retryFailedImportLog,
  retryFailedImportsForUser,
  reprocessImportLog,
  buildGmailImportPushPayload,
  buildItemHistoryReviewAdjustment,
};
