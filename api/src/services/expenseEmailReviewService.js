const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const EmailImportLog = require('../models/emailImportLog');
const { attachGmailReviewHint } = require('./expenseReviewContext');

function isItemReviewField(field = '') {
  const normalized = `${field || ''}`;
  return normalized.startsWith('items') && normalized !== 'items_reviewed_clean';
}

function normalizeReviewContext(value) {
  const raw = `${value || ''}`.trim().toLowerCase();
  if (raw === 'quick_check') return 'review_path_quick_check';
  if (raw === 'items_first') return 'review_path_items_first';
  if (raw === 'full_review') return 'review_path_full_review';
  return null;
}

function normalizeDismissalReason(value) {
  const raw = `${value || ''}`.trim().toLowerCase();
  if (raw === 'not_an_expense') return 'dismiss_reason_not_an_expense';
  if (raw === 'duplicate') return 'dismiss_reason_duplicate';
  if (raw === 'business_or_track_only') return 'dismiss_reason_business_or_track_only';
  if (raw === 'transfer_or_payment') return 'dismiss_reason_transfer_or_payment';
  if (raw === 'wrong_details') return 'dismiss_reason_wrong_details';
  if (raw === 'other') return 'dismiss_reason_other';
  return null;
}

function normalizeApprovedEmailNotes(notes = '') {
  if (!notes) return notes;
  return `${notes}`
    .replace(/\(\s*needs review\s*\)/ig, '(imported from Gmail)')
    .replace(/\bneeds review\b/ig, 'imported from Gmail')
    .trim();
}

async function handleDismissedExpenseReview(expense, userId, dismissalReason) {
  if (!expense?.id || expense.source !== 'email') return expense;
  const dismissalReasonField = normalizeDismissalReason(dismissalReason);
  await Expense.updateReviewMetadata(expense.id, userId, { reviewRequired: false }) || expense;
  await EmailImportLog.recordReviewFeedback(expense.id, {
    action: 'dismissed',
    changedFields: dismissalReasonField ? [dismissalReasonField] : [],
  });
  return expense;
}

async function handleApprovedExpenseReview(expense, userId, reviewContext) {
  if (!expense?.id || expense.source !== 'email') return expense;
  let nextExpense = expense;
  let items = [];
  let existingReviewFields = [];
  try {
    const [existingLog, existingItems] = await Promise.all([
      EmailImportLog.findByExpenseId(expense.id),
      ExpenseItem.findByExpenseId(expense.id),
    ]);
    existingReviewFields = Array.isArray(existingLog?.review_changed_fields)
      ? existingLog.review_changed_fields
      : [];
    items = Array.isArray(existingItems) ? existingItems : [];
  } catch (err) {
    console.error('[expenses/approve] review context lookup failed:', {
      expense_id: expense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
  }
  const normalizedNotes = normalizeApprovedEmailNotes(expense.notes || '');
  if (normalizedNotes && normalizedNotes !== expense.notes) {
    try {
      nextExpense = await Expense.update(expense.id, userId, { notes: normalizedNotes }) || nextExpense;
    } catch (err) {
      console.error('[expenses/approve] note normalization update failed:', {
        expense_id: expense.id,
        message: err?.message || String(err || 'unknown_error'),
      });
    }
  }
  try {
    nextExpense = await Expense.updateReviewMetadata(nextExpense.id, userId, { reviewRequired: false }) || nextExpense;
  } catch (err) {
    console.error('[expenses/approve] review metadata update failed:', {
      expense_id: nextExpense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
  }
  const reviewContextField = normalizeReviewContext(reviewContext);
  const changedFields = reviewContextField ? [reviewContextField] : [];
  const hadItemCorrections = existingReviewFields.some(isItemReviewField);
  if (reviewContextField === 'review_path_items_first' && items.length > 0 && !hadItemCorrections) {
    changedFields.push('items_reviewed_clean');
  }
  try {
    await EmailImportLog.recordReviewFeedback(nextExpense.id, {
      action: 'approved',
      changedFields,
    });
  } catch (err) {
    console.error('[expenses/approve] email review feedback failed:', {
      expense_id: nextExpense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
  }
  if (items.length > 0) {
    nextExpense = {
      ...nextExpense,
      items,
      item_count: items.length,
    };
  }
  try {
    return await attachGmailReviewHint(nextExpense, userId);
  } catch (err) {
    console.error('[expenses/approve] gmail hint attach failed:', {
      expense_id: nextExpense.id,
      message: err?.message || String(err || 'unknown_error'),
    });
    return { ...nextExpense, gmail_review_hint: null };
  }
}

module.exports = {
  handleApprovedExpenseReview,
  handleDismissedExpenseReview,
  normalizeApprovedEmailNotes,
  normalizeDismissalReason,
  normalizeReviewContext,
};
