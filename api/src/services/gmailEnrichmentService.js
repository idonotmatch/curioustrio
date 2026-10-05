const db = require('../db');
const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const User = require('../models/user');
const Category = require('../models/category');
const { resolveProductMatch } = require('./productResolver');
const { getItemHistoryByGroupKey } = require('./itemHistoryService');
const { getSenderImportQuality, recommendReviewMode } = require('./gmailImportQualityService');
const { emitExpenseFreshnessEvent } = require('./freshnessEvents');
const { requestProjectionRefresh } = require('./projectionRefreshService');
const { getMessage } = require('./gmailClient');
const { buildItemHistoryReviewAdjustment, resolveEmailLocation } = require('./gmailImporter');
const { assignCategory } = require('./categoryAssigner');

const REVIEW_MODE_RANK = { quick_check: 0, items_first: 1, full_review: 2 };

function stricterReviewMode(current, recommended) {
  const currentMode = current || 'full_review';
  const recommendedMode = recommended || currentMode;
  return (REVIEW_MODE_RANK[recommendedMode] ?? 2) > (REVIEW_MODE_RANK[currentMode] ?? 2)
    ? recommendedMode
    : currentMode;
}

async function enrichLocation(expense, log) {
  if (
    !expense
    || expense.location_user_owned
    || expense.place_name
    || expense.address
    || expense.mapkit_stable_id
  ) return false;

  let locationBody = log?.snippet || '';
  if (log?.message_id) {
    try {
      const message = await getMessage(expense.user_id, log.message_id);
      locationBody = message?.body || locationBody;
    } catch (err) {
      console.error('[gmail enrichment] message reload failed; using stored snippet:', {
        expense_id: expense.id,
        message: err?.message || String(err || 'unknown_error'),
      });
    }
  }

  const { location } = await resolveEmailLocation({
    merchant: expense.merchant,
    subject: log?.subject || '',
    from: log?.from_address || '',
    body: locationBody,
  });
  if (!location) return false;

  const result = await db.query(
    `UPDATE expenses
     SET place_name = $3,
         address = $4,
         mapkit_stable_id = $5,
         location_provider_id = $6,
         location_latitude = $7,
         location_longitude = $8,
         location_source = 'email',
         location_status = 'enriched',
         location_confidence = CASE WHEN $5::text IS NULL THEN 0.5 ELSE 0.95 END
     WHERE id = $1
       AND user_id = $2
       AND COALESCE(location_user_owned, FALSE) = FALSE
       AND place_name IS NULL
       AND address IS NULL
       AND mapkit_stable_id IS NULL
     RETURNING id`,
    [
      expense.id,
      expense.user_id,
      location.place_name || null,
      location.address || null,
      location.mapkit_stable_id || null,
      location.provider_place_id || null,
      location.latitude ?? null,
      location.longitude ?? null,
    ]
  );
  return result.rows.length > 0;
}

async function enrichCategory(user, expense) {
  if (expense.category_id) return false;
  const categories = await Category.findByHousehold(user.household_id);
  const assignment = await assignCategory({
    merchant: expense.merchant,
    description: expense.description,
    householdId: user.household_id,
    categories,
    allowDeferredFallback: true,
  });
  if (!assignment?.category_id) return false;

  const result = await db.query(
    `UPDATE expenses
     SET category_id = $3,
         category_source = $4,
         category_confidence = $5,
         category_reasoning = $6::jsonb
     WHERE id = $1
       AND user_id = $2
       AND category_id IS NULL
     RETURNING id`,
    [
      expense.id,
      user.id,
      assignment.category_id,
      assignment.source || null,
      assignment.confidence ?? null,
      JSON.stringify(assignment.reasoning || null),
    ]
  );
  return result.rows.length > 0;
}

async function buildHistoryAdjustment(user, expense, items, buildItemHistoryReviewAdjustment) {
  const uniqueGroupKeys = [...new Set(items
    .map((item) => item.product_id
      ? `product:${item.product_id}`
      : (item.comparable_key ? `comparable:${item.comparable_key}` : null))
    .filter(Boolean))]
    .slice(0, 2);
  if (!uniqueGroupKeys.length) return null;

  const histories = await Promise.all(uniqueGroupKeys.map((groupKey) => (
    getItemHistoryByGroupKey(user.id, groupKey, { scope: 'personal', lookbackDays: 180 })
  )));
  const contexts = histories.map((history, index) => {
    if (!history) return null;
    const groupKey = uniqueGroupKeys[index];
    const currentItem = items.find((item) => (
      item.product_id ? `product:${item.product_id}` : (item.comparable_key ? `comparable:${item.comparable_key}` : null)
    ) === groupKey);
    return { ...history, current_item_amount: currentItem?.amount ?? null };
  }).filter(Boolean);
  return buildItemHistoryReviewAdjustment(expense, contexts);
}

async function runGmailEnrichmentJob(payload = {}) {
  const user = await User.findById(payload.user_id);
  const expense = await Expense.findById(payload.expense_id);
  if (!user || !expense || expense.user_id !== user.id || expense.source !== 'email') {
    return { skipped: true, reason: 'expense_missing_or_ineligible' };
  }

  const log = await EmailImportLog.findByExpenseId(expense.id);
  const items = await ExpenseItem.findByExpenseId(expense.id);
  let resolvedCount = 0;
  const resolvedItems = [];
  for (const item of items) {
    if (item.product_id || item.product_match_reason === 'user_rejected_match') {
      resolvedItems.push(item);
      continue;
    }
    const resolution = await resolveProductMatch(item, expense.merchant, {
      householdId: user.household_id,
    });
    if (!resolution?.product_id) {
      resolvedItems.push(item);
      continue;
    }
    const updated = await ExpenseItem.updateResolution(item.id, expense.id, {
      productId: resolution.product_id,
      productMatchConfidence: resolution.confidence,
      productMatchReason: resolution.reason,
    });
    resolvedItems.push(updated || item);
    resolvedCount += 1;
  }

  const historyAdjustment = await buildHistoryAdjustment(
    user,
    expense,
    resolvedItems,
    buildItemHistoryReviewAdjustment
  );
  const hasUncertainMatches = resolvedItems.some((item) => item.product_match_confidence === 'medium');
  let reviewMode = expense.review_mode || 'full_review';
  if (expense.status === 'pending' && expense.review_required !== false) {
    if (historyAdjustment?.level === 'noisy') {
      reviewMode = 'full_review';
    } else if (reviewMode !== 'full_review' && hasUncertainMatches) {
      reviewMode = 'items_first';
    } else if (reviewMode !== 'full_review' && log?.from_address) {
      const senderQuality = await getSenderImportQuality(user.id, log.from_address, log.subject || '');
      const effectiveQuality = historyAdjustment?.level
        ? {
            ...senderQuality,
            item_reliability: {
              ...(senderQuality.item_reliability || {}),
              level: historyAdjustment.level,
              message: historyAdjustment.message,
            },
          }
        : senderQuality;
      reviewMode = stricterReviewMode(reviewMode, recommendReviewMode(effectiveQuality));
    }
    if (reviewMode !== expense.review_mode) {
      await Expense.updateReviewMetadata(expense.id, user.id, {
        reviewRequired: true,
        reviewMode,
        reviewSource: 'gmail',
      });
    }
  }

  const [categoryEnriched, locationEnriched] = await Promise.all([
    enrichCategory(user, expense),
    enrichLocation(expense, log),
  ]);
  const changed = resolvedCount > 0 || categoryEnriched || locationEnriched || reviewMode !== expense.review_mode;
  await requestProjectionRefresh({
    user,
    reason: 'gmail_expense_enriched',
    expense,
    metadata: {
      source: 'gmail_enrichment',
      resolved_item_count: resolvedCount,
      category_enriched: categoryEnriched,
    },
  });
  if (changed) {
    await emitExpenseFreshnessEvent(user, expense, {
      eventType: 'gmail_expense_enriched',
      includePending: true,
      includeGmail: true,
      metadata: {
        resolved_item_count: resolvedCount,
        category_enriched: categoryEnriched,
        location_enriched: locationEnriched,
        review_mode: reviewMode,
      },
    });
  }

  return {
    expense_id: expense.id,
    resolved_item_count: resolvedCount,
    category_enriched: categoryEnriched,
    location_enriched: locationEnriched,
    review_mode: reviewMode,
  };
}

module.exports = { runGmailEnrichmentJob, stricterReviewMode };
