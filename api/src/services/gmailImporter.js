const User = require('../models/user');
const Expense = require('../models/expense');
const Category = require('../models/category');
const EmailImportLog = require('../models/emailImportLog');
const ExpenseItem = require('../models/expenseItem');
const BackgroundJob = require('../models/backgroundJob');
const PushToken = require('../models/pushToken');
const db = require('../db');
const { listRecentMessages, getMessage } = require('./gmailClient');
const {
  classifyEmailExpense,
  parseEmailExpense,
  extractDeterministicTotalAmount,
  extractDiscountLikeAmounts,
  shouldOverrideParsedAmount,
  extractFallbackItemsFromEmailBody,
  summarizeStructuredItemBlock,
  analyzeEmailSignals,
  classifyEmailModality,
  extractEmailLocationCandidate,
  clampExpenseDate,
} = require('./emailParser');
const { assignCategory } = require('./categoryAssigner');
const { sendNotifications } = require('./pushService');
const { searchPlace } = require('./mapkitService');
const {
  getSenderImportQuality,
  recommendReviewMode,
} = require('./gmailImportQualityService');
const { extractSenderDomain, extractSubjectPattern } = require('./gmailImportFingerprint');
const { requestProjectionRefresh } = require('./projectionRefreshService');
const { emitExpenseFreshnessEvent } = require('./freshnessEvents');
const { pushNotificationsEnabled } = require('./pushPreferences');
const { safePushData, shouldSendGmailReviewPush } = require('./pushEligibility');
const detectDuplicates = require('./duplicateDetector');

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

  const deterministicTotal = extractDeterministicTotalAmount(body);
  if (Number.isFinite(deterministicTotal) && deterministicTotal !== 0) {
    return deterministicTotal;
  }

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

function normalizeParsedAmountAgainstDeterministicTotal(parsed = null, body = '', classification = {}) {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const deterministicTotal = extractDeterministicTotalAmount(body);
  const discountLikeAmounts = extractDiscountLikeAmounts(body);
  if (!shouldOverrideParsedAmount(parsed, deterministicTotal, discountLikeAmounts)) {
    return parsed;
  }

  const normalizedAmount = classification?.disposition === 'refund'
    ? -Math.abs(Number(deterministicTotal))
    : Math.abs(Number(deterministicTotal));

  return {
    ...parsed,
    amount: normalizedAmount,
  };
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

  let trustedSignals = 0;
  let cautionSignals = 0;

  for (const context of contexts) {
    const latestPurchase = context.latest_purchase || null;
    const latestMerchant = `${latestPurchase?.merchant || ''}`.trim().toLowerCase();
    const currentMerchant = `${expenseLike.merchant || ''}`.trim().toLowerCase();
    const currentItemAmount = Math.abs(Number(context.current_item_amount || 0));
    const medianAmount = Number(context.median_amount || 0);
    const deltaPercent = medianAmount > 0 && currentItemAmount > 0
      ? Math.round((Math.abs(currentItemAmount - medianAmount) / medianAmount) * 100)
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

function buildStructuredItemReviewAdjustment({
  senderQuality = {},
  structuredItemSignal = {},
  deterministicItemCount = 0,
} = {}) {
  if (structuredItemSignal?.level !== 'strong') return null;
  if (Number(deterministicItemCount || 0) < 2) return null;
  if ((senderQuality?.level || 'unknown') === 'noisy') return null;

  const currentItemLevel = senderQuality?.item_reliability?.level || 'unknown';
  return {
    reviewMode: 'items_first',
    item_reliability: {
      ...(senderQuality?.item_reliability || {}),
      level: currentItemLevel === 'trusted' ? 'trusted' : 'mixed',
      message: 'This email has a clear structured item block, so review the extracted items first.',
    },
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
  qualityCache = null,
  allowExistingRetry = false,
  forceReview = false,
  existingLog = null,
  outcomes = createOutcomes(),
  persistenceClient: providedPersistenceClient = null,
} = {}) {
  if (!allowExistingRetry) {
    const existing = existingLog || await EmailImportLog.findByMessageId(user.id, msgId);
    if (existing) {
      outcomes.skipped_existing++;
      return { imported: 0, skipped: 1, failed: 0, reason: 'existing' };
    }
  }

  let msgSubject, msgFrom, msgSnippet, createdExpense;
  try {
    const { subject, from, body, snippet, receivedAt } = await getMessage(user.id, msgId);
    msgSubject = subject;
    msgFrom = from;
    msgSnippet = snippet;
    const messageDateContext = receivedAt && /^\d{4}-\d{2}-\d{2}$/.test(receivedAt) ? receivedAt : todayDate;
    const qualityKey = `${extractSenderDomain(from)}:${extractSubjectPattern(subject, from)}`;
    let qualityPromise = qualityCache?.get(qualityKey);
    if (!qualityPromise) {
      qualityPromise = getSenderImportQuality(user.id, from, subject);
      qualityCache?.set(qualityKey, qualityPromise);
    }
    const senderQuality = await qualityPromise;
    const softenSkipBehavior = forceReview || senderQuality?.sender_preference?.force_review || shouldSoftenSkipBehavior(senderQuality);
    const templateQuality = senderQuality?.template_quality || {};
    const classification = await classifyEmailExpense(body, subject, from, messageDateContext, snippet);
    const signals = analyzeEmailSignals(subject, from, body);
    const structuredItemSignal = summarizeStructuredItemBlock(body);

    if (
      templateQuality.should_skip_prequeue
      && !forceReview
      && !senderQuality?.sender_preference?.force_review
      && !signals.shouldSurfaceToReview
      && !signals.strongMoneySignal
      && !signals.mediumMoneySignal
    ) {
      const skipReason = `template_skip_${templateQuality.subject_pattern || 'non_transactional'}`;
      await EmailImportLog.upsertResult({
        userId: user.id, messageId: msgId, status: 'skipped',
        subject, fromAddress: from, skipReason, snippet,
        structuredItemBlockLevel: structuredItemSignal.level,
        deterministicItemCount: structuredItemSignal.deterministic_item_count,
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
          structuredItemBlockLevel: structuredItemSignal.level,
          deterministicItemCount: structuredItemSignal.deterministic_item_count,
        });
        increment(outcomes.skipped_reasons, skipReason);
        return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
      }
    }

    let parsed = await parseEmailExpense(body, subject, from, messageDateContext, snippet);
    parsed = normalizeParsedAmountAgainstDeterministicTotal(parsed, body, classification);
    const deterministicFallbackItems = extractFallbackItemsFromEmailBody(body);
    let importedAsPendingReview = false;
    const maxExpenseDate = messageDateContext < todayDate ? messageDateContext : todayDate;

    if (!parsed || !hasValidParsedAmount(parsed)) {
      const fallbackAmount = findLikelyAmount(subject, snippet, body);
      if (!fallbackAmount) {
        const skipReason = classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount';
        await EmailImportLog.upsertResult({
          userId: user.id, messageId: msgId, status: 'skipped',
          subject, fromAddress: from, skipReason, snippet,
          structuredItemBlockLevel: structuredItemSignal.level,
          deterministicItemCount: structuredItemSignal.deterministic_item_count,
        });
        increment(outcomes.skipped_reasons, skipReason);
        return { imported: 0, skipped: 1, failed: 0, reason: skipReason };
      }
      if (senderQuality.level === 'noisy' && !softenSkipBehavior && Number(templateQuality.filtering_dismissals || 0) >= 2) {
        const skipReason = 'low_sender_quality';
        await EmailImportLog.upsertResult({
          userId: user.id, messageId: msgId, status: 'skipped',
          subject, fromAddress: from, skipReason, snippet,
          structuredItemBlockLevel: structuredItemSignal.level,
          deterministicItemCount: structuredItemSignal.deterministic_item_count,
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
        items: Array.isArray(parsed?.items) && parsed.items.length > 0
          ? parsed.items
          : (deterministicFallbackItems.length > 0 ? deterministicFallbackItems : null),
      };
      importedAsPendingReview = true;
    }

    parsed.date = clampExpenseDate(parsed.date, maxExpenseDate);
    if (!hasValidParsedAmount(parsed)) {
      const skipReason = classification.disposition === 'uncertain' ? 'classifier_uncertain' : 'missing_amount';
      await EmailImportLog.upsertResult({
        userId: user.id, messageId: msgId, status: 'skipped',
        subject, fromAddress: from, skipReason, snippet,
        structuredItemBlockLevel: structuredItemSignal.level,
        deterministicItemCount: structuredItemSignal.deterministic_item_count,
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

    const categoryAssignment = await assignCategory({
      merchant: parsed.merchant,
      description: parsed.description,
      householdId: user.household_id,
      categories,
      skipAiFallback: true,
    });
    const { category_id } = categoryAssignment;
    let itemsForPersistence = [];
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      itemsForPersistence = parsed.items.filter(it => it.description).map((item) => ({
        ...item,
        source_type: 'email',
        raw_description: item.description,
        extraction_confidence: item.amount != null ? 'medium' : 'low',
        product_id: null,
        product_match_confidence: null,
        product_match_reason: null,
      }));
    }

    let effectiveSenderQuality = senderQuality;

    const structuredItemAdjustment = buildStructuredItemReviewAdjustment({
      senderQuality: effectiveSenderQuality,
      structuredItemSignal,
      deterministicItemCount: deterministicFallbackItems.length,
    });
    if (structuredItemAdjustment?.item_reliability) {
      effectiveSenderQuality = {
        ...effectiveSenderQuality,
        item_reliability: structuredItemAdjustment.item_reliability,
      };
    }

    let reviewMode = forceReview ? 'full_review' : (structuredItemAdjustment?.reviewMode || recommendReviewMode(effectiveSenderQuality));

    const persistenceClient = providedPersistenceClient || await db.pool.connect();
    const ownsPersistenceClient = !providedPersistenceClient;
    let expense;
    try {
      await persistenceClient.query('BEGIN');
      expense = await Expense.create({
        userId: user.id,
        householdId: user.household_id,
        merchant: parsed.merchant,
        description: parsed.description || null,
        amount: parsed.amount,
        date: parsed.date,
        categoryId: category_id,
        source: 'email',
        status: 'pending',
        notes: parsed.notes,
        placeName: null,
        address: null,
        mapkitStableId: null,
        paymentMethod: parsed.payment_method || 'unknown',
        cardLast4: parsed.card_last4 || null,
        cardLabel: parsed.card_label || null,
        categorySource: categoryAssignment.source || null,
        categoryConfidence: categoryAssignment.confidence ?? null,
        categoryReasoning: categoryAssignment.reasoning || null,
        reviewRequired: true,
        reviewMode: reviewMode || null,
        reviewSource: 'gmail',
        queryable: persistenceClient,
      });
      if (itemsForPersistence.length > 0) {
        await ExpenseItem.createBulk(expense.id, itemsForPersistence, persistenceClient);
      }
      await EmailImportLog.upsertResult({
        userId: user.id,
        messageId: msgId,
        expenseId: expense.id,
        status: 'imported',
        subject: msgSubject,
        fromAddress: msgFrom,
        snippet: msgSnippet,
        structuredItemBlockLevel: structuredItemSignal.level,
        deterministicItemCount: structuredItemSignal.deterministic_item_count,
      }, persistenceClient);
      await BackgroundJob.enqueue({
        jobType: BackgroundJob.JOB_TYPES.gmailEnrichment,
        dedupeKey: expense.id,
        payload: {
          user_id: user.id,
          expense_id: expense.id,
        },
        queryable: persistenceClient,
      });
      await persistenceClient.query('COMMIT');
      createdExpense = expense;
    } catch (persistenceError) {
      try {
        await persistenceClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[gmail import] persistence rollback failed', {
          message: rollbackError?.message || String(rollbackError || 'unknown_error'),
        });
      }
      throw persistenceError;
    } finally {
      if (ownsPersistenceClient) persistenceClient.release();
    }

    let duplicateFlags = [];
    try {
      duplicateFlags = await detectDuplicates(expense);
      if (duplicateFlags.length > 0 && reviewMode !== 'full_review') {
        reviewMode = 'full_review';
        expense = await Expense.updateReviewMetadata(expense.id, user.id, {
          reviewRequired: true,
          reviewMode,
          reviewSource: 'gmail',
        }) || expense;
        createdExpense = expense;
      }
    } catch (duplicateError) {
      console.error('[gmail import] duplicate detection failed (non-fatal)', {
        message: duplicateError?.message || String(duplicateError || 'unknown_error'),
      });
    }

    if (reviewMode === 'quick_check') {
      outcomes.imported_fast_lane++;
    } else if (reviewMode === 'items_first') {
      outcomes.imported_items_first++;
    } else {
      outcomes.imported_full_review++;
    }
    outcomes.imported_pending_review++;
    await requestProjectionRefresh({
      user,
      reason: 'gmail_expense_imported',
      expense,
      metadata: {
        source: 'gmail_import',
        message_id: msgId,
        review_mode: reviewMode || null,
      },
    });
    try {
      await emitExpenseFreshnessEvent(user, expense, {
        eventType: 'gmail_expense_imported',
        includePending: true,
        includeGmail: true,
        metadata: {
          source: 'gmail_import',
          review_mode: reviewMode || null,
        },
      });
    } catch (freshnessError) {
      console.error('[gmail import] freshness event failed (non-fatal)', {
        message: freshnessError?.message || String(freshnessError || 'unknown_error'),
      });
    }
    return { imported: 1, skipped: 0, failed: 0, expense, duplicate_flags: duplicateFlags };
  } catch (e) {
    const failureReason = summarizeImportFailure(e);
    console.error('[gmail import] message failed', {
      reason: failureReason,
      message: `${e?.message || 'unknown_error'}`.slice(0, 160),
    });
    increment(outcomes.failed_reasons, failureReason);
    if (existingLog && !msgFrom) {
      await EmailImportLog.markRetryFailed(existingLog.id, user.id, failureReason);
    } else {
      await EmailImportLog.upsertResult({
        userId: user.id, messageId: msgId, status: 'failed',
        expenseId: createdExpense?.id || null,
        subject: msgSubject, fromAddress: msgFrom, skipReason: failureReason, snippet: msgSnippet,
      });
    }
    return { imported: 0, skipped: 0, failed: 1, error: e };
  }
}

async function processMessageImportWithLock(user, msgId, options = {}) {
  const client = await db.pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [user.id, msgId]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      if (options.outcomes) options.outcomes.skipped_existing++;
      return { imported: 0, skipped: 1, failed: 0, reason: 'processing' };
    }
    return await processMessageImport(user, msgId, { ...options, persistenceClient: client });
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [user.id, msgId]);
      } catch (err) {
        console.error('[gmail import] message lock release failed', { message: err?.message || String(err) });
      }
    }
    client.release();
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
  const qualityCache = new Map();

  for (const msg of messages) {
    const result = await processMessageImportWithLock(user, msg.id, {
      categories,
      todayDate,
      outcomes,
      qualityCache,
    });
    imported += result.imported;
    skipped += result.skipped;
    failed += result.failed;
  }

  // Send push notification if new expenses were imported
  if (imported > 0) {
    try {
      const notification = buildGmailImportPushPayload(imported, outcomes);
      const eligibility = shouldSendGmailReviewPush({
        imported,
        pendingReview: notification.data?.review_count || 0,
        preferenceEnabled: pushNotificationsEnabled(user, 'push_gmail_review_enabled'),
      });
      if (eligibility.send) {
        const tokens = await PushToken.findByUser(user.id);
        if (tokens.length > 0) {
          await sendNotifications(tokens.map(t => ({
            to: t.token,
            title: notification.title,
            body: notification.body,
            data: safePushData(notification.data),
          })));
        }
      }
    } catch (e) {
      console.error('[gmail import] push notification failed', {
        reason: summarizeImportFailure(e),
      });
    }
  }

  return { imported, skipped, failed, outcomes };
}

async function recoverImportLog(user, log, {
  forceReview = false,
  outcomes = createOutcomes(),
  qualityCache = null,
} = {}) {
  // Serialize recovery across API instances, then re-read to make repeated taps idempotent.
  const client = await db.pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      [user.id, log.message_id]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      throw Object.assign(new Error('This email is already being processed. Try again shortly.'), { status: 409 });
    }
    const current = await EmailImportLog.findByIdForUser(log.id, user.id);
    if (!current) throw Object.assign(new Error('Import log not found'), { status: 404 });
    if (current.expense_id || current.status === 'imported') {
      return { imported: 0, skipped: 1, failed: 0, reason: 'existing' };
    }
    if (!['skipped', 'failed'].includes(current.status) || (!forceReview && current.status !== 'failed')) {
      throw Object.assign(new Error('This import cannot be retried'), { status: 400 });
    }
    if (forceReview && current.status === 'skipped' && current.skip_reason !== 'duplicate_expense') {
      await EmailImportLog.recordLogFeedback(current.id, user.id, 'should_have_imported');
    }
    const categories = await Category.findByHousehold(user.household_id);
    return await processMessageImport(user, current.message_id, {
      categories,
      todayDate: new Date().toISOString().split('T')[0],
      allowExistingRetry: true,
      forceReview,
      existingLog: current,
      outcomes,
      qualityCache,
      persistenceClient: client,
    });
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [user.id, log.message_id]);
      } catch (unlockError) {
        console.error('[gmail import] recovery lock release failed', {
          message: unlockError?.message || String(unlockError || 'unknown_error'),
        });
      }
    }
    client.release();
  }
}

async function retryFailedImportLog(user, log, options = {}) {
  return recoverImportLog(user, log, options);
}

async function reviewSkippedImportLog(user, log) {
  return recoverImportLog(user, log, { forceReview: true });
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
  const qualityCache = new Map();

  for (const log of failedLogs) {
    const result = await retryFailedImportLog(user, log, { outcomes, qualityCache });
    imported += result.imported;
    skipped += result.skipped;
    failed += result.failed;
  }
  return { imported, skipped, failed, outcomes, attempted: failedLogs.length };
}

module.exports = {
  importForUser,
  retryFailedImportLog,
  reviewSkippedImportLog,
  retryFailedImportsForUser,
  reprocessImportLog,
  findLikelyAmount,
  normalizeParsedAmountAgainstDeterministicTotal,
  buildGmailImportPushPayload,
  buildItemHistoryReviewAdjustment,
  buildStructuredItemReviewAdjustment,
  resolveEmailLocation,
};
