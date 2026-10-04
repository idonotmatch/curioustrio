const db = require('../db');
const DuplicateFlag = require('../models/duplicateFlag');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const { getItemHistoryByGroupKey } = require('./itemHistoryService');
const { getSenderImportQuality } = require('./gmailImportQualityService');
const Category = require('../models/category');
const { explainAssignedCategory } = require('./categoryAssigner');
const { buildExpenseTreatmentSuggestion } = require('./expenseTreatmentSuggestion');
const { buildEmailReviewHint } = require('./emailReviewHint');
const { decodeHtmlEntities } = require('../utils/htmlEntities');

function decodeEmailField(value) {
  const decoded = decodeHtmlEntities(`${value || ''}`).replace(/\s+/g, ' ').trim();
  return decoded || null;
}

async function attachGmailReviewHint(expense, userId, { compact = false, emailLog = null } = {}) {
  if (!expense || expense.source !== 'email') return expense;
  const log = emailLog || await EmailImportLog.findByExpenseId(expense.id);
  if (!log?.message_id) {
    return {
      ...expense,
      email_subject: decodeEmailField(expense?.email_subject),
      email_from_address: expense?.email_from_address || null,
      email_snippet: decodeEmailField(expense?.email_snippet),
      gmail_review_hint: null,
    };
  }

  let senderQuality = {
    level: 'unknown',
    sender_domain: log?.sender_domain || null,
    metrics: null,
    item_reliability: null,
    top_changed_fields: [],
  };
  const senderIdentity = log?.from_address || log?.sender_domain || null;
  if (senderIdentity && !compact) {
    try {
      senderQuality = await getSenderImportQuality(userId, senderIdentity, log.subject || '');
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
  let categoryExplanation = null;
  try {
    if (!compact) treatmentSuggestion = await buildExpenseTreatmentSuggestion(expense, userId);
  } catch (err) {
    console.error('[expenseReviewContext] treatment suggestion failed:', {
      expense_id: expense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
  }

  try {
    if (!compact && expense?.category_id) {
      const categories = await Category.findByHousehold(expense?.household_id || null);
      categoryExplanation = await explainAssignedCategory({
        householdId: expense?.household_id || null,
        merchant: expense?.merchant || '',
        description: expense?.description || expense?.notes || '',
        categoryId: expense.category_id,
        categories,
      });
    }
  } catch (err) {
    console.error('[expenseReviewContext] category explanation failed:', {
      expense_id: expense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
  }

  return {
    ...expense,
    email_subject: decodeEmailField(log.subject),
    email_from_address: log.from_address || log.sender_domain || null,
    email_snippet: decodeEmailField(log.snippet),
    gmail_review_hint: {
      ...buildEmailReviewHint(expense, {
        ...log,
        subject: decodeEmailField(log.subject),
        snippet: decodeEmailField(log.snippet),
      }, senderQuality),
      treatment_suggestion: treatmentSuggestion,
      category_explanation: categoryExplanation,
    },
  };
}

async function fetchPendingExpensesBase(userId, { limit = null, cursor = null } = {}) {
  const params = [userId];
  let cursorClause = '';
  if (cursor?.date && cursor?.created_at && cursor?.id) {
    params.push(cursor.date, cursor.created_at, cursor.id);
    cursorClause = `AND (e.date, e.created_at, e.id) < ($2::date, $3::timestamptz, $4::uuid)`;
  }
  let limitClause = '';
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.push(Math.min(Number(limit), 51));
    limitClause = `LIMIT $${params.length}`;
  }
  const result = await db.query(
    `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count,
            l.message_id AS email_message_id,
            l.imported_at AS email_imported_at,
            l.review_action AS email_review_action,
            l.review_edit_count AS email_review_edit_count,
            l.sender_domain AS email_sender_domain,
            l.subject_pattern AS email_subject_pattern,
            l.subject AS email_subject,
            l.from_address AS email_from_address,
            l.snippet AS email_snippet
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     LEFT JOIN LATERAL (
       SELECT log.message_id, log.imported_at,
              feedback.review_action, feedback.review_edit_count,
              log.sender_domain, log.subject_pattern, log.subject,
              log.from_address, log.snippet
       FROM email_import_log log
       LEFT JOIN email_import_feedback feedback ON feedback.expense_id = log.expense_id
       WHERE log.expense_id = e.id
       ORDER BY log.imported_at DESC
       LIMIT 1
     ) l ON TRUE
     WHERE e.user_id = $1 AND e.status = 'pending'
     ${cursorClause}
     ORDER BY e.date DESC, e.created_at DESC, e.id DESC
     ${limitClause}`,
    params
  );
  return result.rows;
}

async function attachDuplicateFlagsBestEffort(expense, userId) {
  if (!expense?.id) return { ...expense, duplicate_flags: [] };
  try {
    const duplicateFlags = await DuplicateFlag.findByExpenseId(expense.id, { userId, pendingOnly: true });
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

async function attachExpenseReviewContext(expense, userId, {
  includeItems = false,
  includeCategoryReasoning = false,
  compact = false,
  duplicateFlags,
} = {}) {
  let enrichedExpense = duplicateFlags
    ? { ...expense, duplicate_flags: duplicateFlags }
    : await attachDuplicateFlagsBestEffort(expense, userId);
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
    const emailLog = enrichedExpense.email_message_id
      ? {
        message_id: enrichedExpense.email_message_id,
        imported_at: enrichedExpense.email_imported_at,
        review_action: enrichedExpense.email_review_action,
        review_edit_count: enrichedExpense.email_review_edit_count,
        sender_domain: enrichedExpense.email_sender_domain,
        subject_pattern: enrichedExpense.email_subject_pattern,
        subject: enrichedExpense.email_subject,
        from_address: enrichedExpense.email_from_address,
        snippet: enrichedExpense.email_snippet,
      }
      : null;
    const result = await attachGmailReviewHint(enrichedExpense, userId, { compact, emailLog });
    const {
      email_message_id,
      email_imported_at,
      email_review_action,
      email_review_edit_count,
      email_sender_domain,
      email_subject_pattern,
      ...cleanExpense
    } = result;
    return cleanExpense;
  } catch (err) {
    console.error('[expenseReviewContext] gmail hint attach failed:', {
      expense_id: enrichedExpense?.id || null,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...enrichedExpense, gmail_review_hint: null };
  }
}

async function attachExpensesReviewContext(expenses = [], userId, {
  includeItems = false,
  includeCategoryReasoning = false,
  compact = false,
} = {}) {
  let duplicateMap = new Map();
  if (typeof DuplicateFlag.findByExpenseIds === 'function') {
    try {
      duplicateMap = await DuplicateFlag.findByExpenseIds(expenses.map((expense) => expense?.id).filter(Boolean), {
        userId,
        pendingOnly: true,
      });
    } catch (err) {
      console.error('[expenseReviewContext] bulk duplicate lookup failed:', err?.message || err);
    }
  }
  const results = await Promise.allSettled(
    expenses.map((expense) => attachExpenseReviewContext(expense, userId, {
      includeItems,
      includeCategoryReasoning,
      compact,
      duplicateFlags: duplicateMap.get(`${expense?.id}`),
    }))
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
