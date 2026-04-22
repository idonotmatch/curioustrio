const db = require('../db');
const Expense = require('../models/expense');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const { getItemHistoryByGroupKey } = require('./itemHistoryService');
const { getSenderImportQuality, recommendReviewMode } = require('./gmailImportQualityService');
const Category = require('../models/category');
const { explainAssignedCategory } = require('./categoryAssigner');

function normalizeText(value = '') {
  return `${value || ''}`.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function descriptionTokens(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !['the', 'and', 'for', 'with', 'from'].includes(token));
}

function descriptionOverlapScore(a = '', b = '') {
  const left = new Set(descriptionTokens(a));
  const right = new Set(descriptionTokens(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function labelBudgetExclusionReason(value = '') {
  const labels = {
    business: 'Business',
    reimbursable: 'Reimbursable',
    another_budget: 'Different budget',
    shared_not_mine: 'Shared, not mine',
    transfer_like: 'Transfer-like',
    other: 'Other',
  };
  return labels[value] || null;
}

function majorityBy(candidates = [], selector) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const value = selector(candidate);
    if (value == null) continue;
    const key = JSON.stringify(value);
    const current = grouped.get(key) || { count: 0, value };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count)[0] || null;
}

async function buildExpenseTreatmentSuggestion(expense, userId) {
  if (!expense?.id || !userId) return null;
  const candidates = await Expense.findTreatmentCandidates({
    userId,
    merchant: expense.merchant,
    categoryId: expense.category_id,
    excludeId: expense.id,
  });

  const merchantNorm = normalizeText(expense.merchant);
  const descriptionNorm = normalizeText(expense.description || expense.notes || '');
  const qualified = [];

  for (const candidate of candidates) {
    let score = 0;
    const sameMerchant = merchantNorm && normalizeText(candidate.merchant) === merchantNorm;
    const sameCategory = expense.category_id && candidate.category_id && `${candidate.category_id}` === `${expense.category_id}`;
    const overlap = descriptionOverlapScore(descriptionNorm, candidate.description || '');
    const amountDelta = Math.abs(Number(candidate.amount || 0) - Number(expense.amount || 0));
    const amountClose = amountDelta <= Math.max(12, Math.abs(Number(expense.amount || 0)) * 0.25);

    if (sameMerchant) score += 1.25;
    if (sameCategory) score += 1;
    if (overlap >= 0.5) score += 1;
    if (amountClose) score += 0.5;

    if (score >= 2) qualified.push(candidate);
  }

  if (qualified.length < 2) return null;

  const grouped = new Map();
  for (const candidate of qualified) {
    const key = JSON.stringify({
      is_private: !!candidate.is_private,
      exclude_from_budget: !!candidate.exclude_from_budget,
      budget_exclusion_reason: candidate.exclude_from_budget ? (candidate.budget_exclusion_reason || null) : null,
    });
    const current = grouped.get(key) || { count: 0, candidate };
    current.count += 1;
    grouped.set(key, current);
  }

  const top = [...grouped.values()].sort((a, b) => b.count - a.count)[0];
  if (!top || top.count < 2 || top.count / qualified.length < 0.75) return null;

  const template = top.candidate;
  const suggestedPrivate = !!template.is_private;
  const suggestedTrackOnly = !!template.exclude_from_budget;
  const suggestedReason = suggestedTrackOnly ? (template.budget_exclusion_reason || null) : null;

  const suggestedCategory = (() => {
    const majority = majorityBy(
      qualified.filter((candidate) => candidate.category_id),
      (candidate) => ({ id: candidate.category_id, name: candidate.category_name || null })
    );
    return majority && majority.count >= 2 && majority.count / qualified.length >= 0.75
      ? majority.value
      : null;
  })();

  const suggestedPayment = (() => {
    const majority = majorityBy(
      qualified.filter((candidate) => candidate.payment_method && candidate.payment_method !== 'unknown'),
      (candidate) => ({
        payment_method: candidate.payment_method,
        card_label: candidate.card_label || null,
        card_last4: candidate.card_last4 || null,
      })
    );
    return majority && majority.count >= 2 && majority.count / qualified.length >= 0.75
      ? majority.value
      : null;
  })();

  if (!suggestedPrivate && !suggestedTrackOnly && !suggestedCategory && !suggestedPayment) return null;

  const parts = [];
  if (suggestedTrackOnly) {
    parts.push(`tracked only${suggestedReason ? ` as ${labelBudgetExclusionReason(suggestedReason)?.toLowerCase() || 'track only'}` : ''}`);
  }
  if (suggestedPrivate) {
    parts.push(suggestedTrackOnly ? 'kept private too' : 'kept private');
  }
  if (suggestedCategory?.name) {
    parts.push(`categorized as ${suggestedCategory.name}`);
  }
  if (suggestedPayment?.payment_method) {
    parts.push(`paid with ${suggestedPayment.payment_method}`);
  }

  return {
    suggested_private: suggestedPrivate,
    suggested_track_only: suggestedTrackOnly,
    budget_exclusion_reason: suggestedReason,
    reason_label: labelBudgetExclusionReason(suggestedReason),
    suggested_category_id: suggestedCategory?.id || null,
    suggested_category_name: suggestedCategory?.name || null,
    suggested_payment_method: suggestedPayment?.payment_method || null,
    suggested_card_label: suggestedPayment?.card_label || null,
    suggested_card_last4: suggestedPayment?.card_last4 || null,
    matched_count: top.count,
    basis_count: qualified.length,
    summary: `You usually ${parts.join(' and ')} for similar expenses.`,
    detail: `${top.count} of ${qualified.length} similar confirmed expenses were handled this way.`,
  };
}

function deriveEmailFieldEvidence(expense, log) {
  if (!expense || !log?.message_id) return {};

  const subject = `${log.subject || ''}`;
  const fromAddress = `${log.from_address || ''}`;
  const merchant = `${expense.merchant || ''}`.trim();
  const amount = Math.abs(Number(expense.amount || 0));
  const importedDate = log.imported_at ? new Date(log.imported_at).toISOString().slice(0, 10) : null;

  let merchantEvidence = null;
  if (merchant) {
    const merchantPattern = merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(merchantPattern, 'i').test(subject)) {
      merchantEvidence = 'Merchant matched from the email subject.';
    } else if (fromAddress.toLowerCase().includes(merchant.toLowerCase().replace(/\s+/g, ''))) {
      merchantEvidence = 'Merchant matched from the sender address.';
    } else if (fromAddress) {
      merchantEvidence = 'Merchant was inferred from the sender and email context.';
    }
  }

  let amountEvidence = null;
  if (amount > 0) {
    const amountPattern = amount.toFixed(2).replace('.', '\\.');
    const text = `${subject} ${expense.notes || ''}`;
    if (new RegExp(`\\$\\s?${amountPattern}\\b`).test(text)) {
      amountEvidence = 'Amount matched a total called out in the email.';
    } else if (Array.isArray(expense.items) && expense.items.length > 0) {
      amountEvidence = `Amount was checked against ${expense.items.length} extracted ${expense.items.length === 1 ? 'line item' : 'line items'}.`;
    } else {
      amountEvidence = 'Amount was extracted from the email purchase summary.';
    }
  }

  let dateEvidence = null;
  if (expense.date && importedDate && expense.date.slice(0, 10) === importedDate) {
    dateEvidence = 'Date is based on when the email was received.';
  } else if (expense.date) {
    dateEvidence = 'Date was extracted from the email timing details.';
  }

  return {
    merchant_evidence: merchantEvidence,
    amount_evidence: amountEvidence,
    date_evidence: dateEvidence,
  };
}

function buildEmailReviewRouting(senderQuality, itemReliability, preferredReviewMode = null) {
  const reviewMode = preferredReviewMode || recommendReviewMode({ ...senderQuality, item_reliability: itemReliability });

  if (reviewMode === 'quick_check') {
    return {
      review_mode: 'quick_check',
      review_title: 'Quick check before approving',
      review_message: senderQuality?.review_path_reliability?.fast_lane_eligible
        ? 'You usually quick-approve imports from this sender, so a fast confirmation is probably enough here.'
        : 'This sender is usually accurate, so a fast confirmation is probably enough here.',
      review_checklist: [
        'Amount: confirm this is the final charged total.',
        'Merchant and date: make sure they look right at a glance.',
      ],
    };
  }

  if (reviewMode === 'items_first') {
    return {
      review_mode: 'items_first',
      review_title: 'Focus on the items before approving',
      review_message: 'The overall import is often usable, but the line items from this sender are where mistakes usually show up.',
      review_checklist: [
        'Items: remove fee, discount, or total rows that should not count as purchases.',
        'Items: make sure the product names and per-item amounts look right.',
        'Amount: confirm the final total still matches what was actually charged.',
      ],
    };
  }

  return {
    review_mode: 'full_review',
    review_title: 'Review this import before approving',
    review_message: 'Use the email context below to confirm the merchant, amount, and date before approving.',
    review_checklist: [
      'Merchant: does the sender and subject match the place you expect?',
      'Amount: does the total reflect the actual charge, not a subtotal or preauth?',
      'Date: is this the purchase day you want to track for the expense?',
    ],
  };
}

function buildEmailReviewHint(expense, log, senderQuality) {
  if (!log?.message_id) return null;

  const level = senderQuality?.level || 'unknown';
  const likelyChangedFields = Array.isArray(senderQuality?.top_changed_fields)
    ? senderQuality.top_changed_fields.map((entry) => entry.field).filter(Boolean)
    : [];
  const itemReliability = senderQuality?.item_reliability || null;
  const fieldEvidence = deriveEmailFieldEvidence(expense, log);
  const reviewRouting = buildEmailReviewRouting(senderQuality, itemReliability, expense.review_mode || null);

  let headline = 'Imported from Gmail';
  let tone = 'info';
  let message = 'Review the details before approving this import.';

  if (log.review_action === 'approved') {
    return {
      sender_domain: senderQuality?.sender_domain || null,
      from_address: log.from_address || null,
      imported_at: log.imported_at || null,
      sender_quality_level: level,
      sender_quality_metrics: senderQuality?.metrics || null,
      likely_changed_fields: likelyChangedFields,
      item_reliability_level: itemReliability?.level || 'unknown',
      item_reliability_message: itemReliability?.message || null,
      item_top_signals: itemReliability?.top_signals || [],
      review_mode: reviewRouting.review_mode,
      review_title: reviewRouting.review_title,
      review_message: reviewRouting.review_message,
      review_checklist: reviewRouting.review_checklist,
      message_subject: log.subject || null,
      message_snippet: log.snippet || null,
      ...fieldEvidence,
      headline: 'Reviewed Gmail import',
      tone: 'positive',
      message: log.review_edit_count > 0
        ? 'This Gmail import was reviewed and updated before it was confirmed.'
        : 'This Gmail import was reviewed before it was confirmed.',
    };
  }

  if (level === 'trusted') {
    tone = 'positive';
    headline = 'Trusted sender';
    message = 'This sender is usually accurate. A quick check is probably enough.';
  } else if (level === 'noisy') {
    tone = 'warning';
    headline = 'Low-confidence sender';
    message = 'Imports from this sender often need edits or get dismissed, so review carefully.';
  } else if (level === 'mixed') {
    tone = 'caution';
    headline = 'Mixed sender history';
    message = 'Imports from this sender are sometimes right and sometimes need correction.';
  }

  return {
    sender_domain: senderQuality?.sender_domain || null,
    from_address: log.from_address || null,
    imported_at: log.imported_at || null,
    sender_quality_level: level,
    sender_quality_metrics: senderQuality?.metrics || null,
    likely_changed_fields: likelyChangedFields,
    item_reliability_level: itemReliability?.level || 'unknown',
    item_reliability_message: itemReliability?.message || null,
    item_top_signals: itemReliability?.top_signals || [],
    review_mode: reviewRouting.review_mode,
    review_title: reviewRouting.review_title,
    review_message: reviewRouting.review_message,
    review_checklist: reviewRouting.review_checklist,
    message_subject: log.subject || null,
    message_snippet: log.snippet || null,
    ...fieldEvidence,
    headline,
    tone,
    message,
  };
}

async function attachGmailReviewHint(expense, userId) {
  if (!expense || expense.source !== 'email') return expense;
  const log = await EmailImportLog.findByExpenseId(expense.id);
  if (!log?.message_id) {
    return {
      ...expense,
      email_subject: expense?.email_subject || null,
      email_from_address: expense?.email_from_address || null,
      email_snippet: expense?.email_snippet || null,
      gmail_review_hint: null,
    };
  }

  let senderQuality = { level: 'unknown', sender_domain: null, metrics: null, item_reliability: null, top_changed_fields: [] };
  if (log?.from_address) {
    try {
      senderQuality = await getSenderImportQuality(userId, log.from_address);
    } catch (err) {
      console.error('[expenseReviewContext] gmail hint quality fallback:', err?.message || err);
      senderQuality = {
        level: 'unknown',
        sender_domain: null,
        metrics: null,
        item_reliability: null,
        top_changed_fields: [],
      };
    }
  }

  let treatmentSuggestion = null;
  try {
    treatmentSuggestion = await buildExpenseTreatmentSuggestion(expense, userId);
  } catch (err) {
    console.error('[expenseReviewContext] treatment suggestion failed:', {
      expense_id: expense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
  }

  return {
    ...expense,
    email_subject: log.subject || null,
    email_from_address: log.from_address || null,
    email_snippet: log.snippet || null,
    gmail_review_hint: {
      ...buildEmailReviewHint(expense, log, senderQuality),
      treatment_suggestion: treatmentSuggestion,
    },
  };
}

async function fetchPendingExpensesBase(userId) {
  const result = await db.query(
    `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
            l.subject AS email_subject,
            l.from_address AS email_from_address,
            l.snippet AS email_snippet
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     LEFT JOIN LATERAL (
       SELECT subject, from_address, snippet
       FROM email_import_log
       WHERE expense_id = e.id
       ORDER BY imported_at DESC
       LIMIT 1
     ) l ON TRUE
     WHERE e.user_id = $1 AND e.status = 'pending'
     ORDER BY e.date DESC, e.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function attachDuplicateFlagsBestEffort(expense) {
  if (!expense?.id) return { ...expense, duplicate_flags: [] };
  try {
    const duplicateFlags = await DuplicateFlag.findByExpenseId(expense.id);
    return { ...expense, duplicate_flags: duplicateFlags };
  } catch (err) {
    console.error('[expenseReviewContext] duplicate flag lookup failed:', {
      expense_id: expense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...expense, duplicate_flags: [] };
  }
}

async function attachItemsBestEffort(expense) {
  if (!expense?.id) return { ...expense, items: [] };
  try {
    const items = await ExpenseItem.findByExpenseId(expense.id);
    return { ...expense, items };
  } catch (err) {
    console.error('[expenseReviewContext] item lookup failed:', {
      expense_id: expense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...expense, items: [] };
  }
}

function buildItemReviewHistorySummary(item = {}, history = null) {
  if (!history?.group_key) return null;
  const latestPurchase = Array.isArray(history.purchases) && history.purchases.length
    ? history.purchases[history.purchases.length - 1]
    : null;

  return {
    group_key: history.group_key,
    item_name: history.item_name || item.description || null,
    brand: history.brand || item.brand || null,
    occurrence_count: Number(history.occurrence_count || 0),
    average_gap_days: history.average_gap_days == null ? null : Number(history.average_gap_days),
    median_amount: history.median_amount == null ? null : Number(history.median_amount),
    median_unit_price: history.median_unit_price == null ? null : Number(history.median_unit_price),
    normalized_total_size_unit: history.normalized_total_size_unit || item.normalized_total_size_unit || item.unit || null,
    last_purchased_at: history.last_purchased_at || null,
    merchants: Array.isArray(history.merchants) ? history.merchants : [],
    merchant_breakdown: Array.isArray(history.merchant_breakdown) ? history.merchant_breakdown.slice(0, 3) : [],
    latest_purchase: latestPurchase ? {
      date: latestPurchase.date || null,
      merchant: latestPurchase.merchant || null,
      amount: latestPurchase.amount == null ? null : Number(latestPurchase.amount),
    } : null,
  };
}

async function attachItemHistoryBestEffort(expense, userId) {
  const items = Array.isArray(expense?.items) ? expense.items : [];
  if (!expense || !items.length || !userId) return { ...expense, item_review_context: [] };

  const scope = expense.user_id === userId ? 'personal' : 'household';
  const ownerId = scope === 'personal' ? userId : expense.household_id;
  if (!ownerId) return { ...expense, item_review_context: [] };

  const candidates = items
    .filter((item) => item?.product_id || item?.comparable_key)
    .map((item) => ({
      item,
      group_key: item.product_id ? `product:${item.product_id}` : `comparable:${item.comparable_key}`,
    }));

  const seen = new Set();
  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (!candidate.group_key || seen.has(candidate.group_key)) continue;
    seen.add(candidate.group_key);
    uniqueCandidates.push(candidate);
    if (uniqueCandidates.length >= 2) break;
  }

  if (!uniqueCandidates.length) return { ...expense, item_review_context: [] };

  const results = await Promise.allSettled(
    uniqueCandidates.map(({ item, group_key }) => (
      getItemHistoryByGroupKey(ownerId, group_key, { scope, lookbackDays: 180 })
        .then((history) => buildItemReviewHistorySummary(item, history))
    ))
  );

  return {
    ...expense,
    item_review_context: results
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value),
  };
}

async function attachCategoryReasoningBestEffort(expense) {
  if (!expense?.id) return { ...expense, category_reasoning: null };
  if (expense.category_reasoning && typeof expense.category_reasoning === 'object') {
    return expense;
  }
  try {
    const categories = expense.household_id
      ? await Category.findByHousehold(expense.household_id)
      : [];
    const categoryReasoning = await explainAssignedCategory({
      householdId: expense.household_id,
      merchant: expense.merchant,
      description: expense.description || expense.notes || null,
      categoryId: expense.category_id,
      categories,
    });
    return { ...expense, category_reasoning: categoryReasoning || null };
  } catch (err) {
    console.error('[expenseReviewContext] category reasoning attach failed:', {
      expense_id: expense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...expense, category_reasoning: null };
  }
}

async function attachExpenseReviewContext(expense, userId, { includeItems = false, includeCategoryReasoning = false } = {}) {
  let enrichedExpense = await attachDuplicateFlagsBestEffort(expense);
  if (includeItems) {
    enrichedExpense = await attachItemsBestEffort(enrichedExpense);
    try {
      enrichedExpense = await attachItemHistoryBestEffort(enrichedExpense, userId);
    } catch (err) {
      console.error('[expenseReviewContext] item history attach failed:', {
        expense_id: enrichedExpense?.id || null,
        message: err?.message || String(err || 'unknown_error'),
      });
      enrichedExpense = { ...enrichedExpense, item_review_context: [] };
    }
  }
  if (includeCategoryReasoning) {
    enrichedExpense = await attachCategoryReasoningBestEffort(enrichedExpense);
  }
  try {
    return await attachGmailReviewHint(enrichedExpense, userId);
  } catch (err) {
    console.error('[expenseReviewContext] gmail hint attach failed:', {
      expense_id: enrichedExpense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...enrichedExpense, gmail_review_hint: null };
  }
}

async function attachExpensesReviewContext(expenses = [], userId, { includeItems = false, includeCategoryReasoning = false } = {}) {
  const results = await Promise.allSettled(
    expenses.map((expense) => attachExpenseReviewContext(expense, userId, { includeItems, includeCategoryReasoning }))
  );
  return results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const expense = expenses[index];
    console.error('[expenseReviewContext] expense enrichment failed:', {
      expense_id: expense?.id || null,
      message: result.reason?.message || String(result.reason || 'unknown_error'),
    });
    return {
      ...expense,
      duplicate_flags: expense?.duplicate_flags || [],
      ...(includeItems ? { items: expense?.items || [], item_review_context: expense?.item_review_context || [] } : {}),
      ...(includeCategoryReasoning ? { category_reasoning: expense?.category_reasoning || null } : {}),
      gmail_review_hint: null,
    };
  });
}

module.exports = {
  attachExpenseReviewContext,
  attachExpensesReviewContext,
  fetchPendingExpensesBase,
};
