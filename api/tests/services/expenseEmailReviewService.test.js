jest.mock('../../src/models/expense', () => ({
  update: jest.fn(),
  updateReviewMetadata: jest.fn(),
}));

jest.mock('../../src/models/expenseItem', () => ({
  findByExpenseId: jest.fn(),
}));

jest.mock('../../src/models/emailImportLog', () => ({
  findByExpenseId: jest.fn(),
  recordReviewFeedback: jest.fn(),
}));

jest.mock('../../src/services/expenseReviewContext', () => ({
  attachGmailReviewHint: jest.fn((expense) => Promise.resolve({ ...expense, gmail_review_hint: { review_mode: expense.review_mode } })),
}));

const Expense = require('../../src/models/expense');
const ExpenseItem = require('../../src/models/expenseItem');
const EmailImportLog = require('../../src/models/emailImportLog');
const { attachGmailReviewHint } = require('../../src/services/expenseReviewContext');
const {
  handleApprovedExpenseReview,
  normalizeReviewContext,
} = require('../../src/services/expenseEmailReviewService');

describe('expenseEmailReviewService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    attachGmailReviewHint.mockImplementation((expense) => Promise.resolve({
      ...expense,
      gmail_review_hint: { review_mode: expense.review_mode },
    }));
    Expense.update.mockResolvedValue(null);
    Expense.updateReviewMetadata.mockImplementation((id, userId, patch) => Promise.resolve({
      id,
      user_id: userId,
      source: 'email',
      status: 'confirmed',
      review_mode: patch.reviewMode || 'items_first',
      notes: 'Imported from Gmail',
    }));
    EmailImportLog.findByExpenseId.mockResolvedValue({
      message_id: 'msg-1',
      review_changed_fields: [],
    });
    ExpenseItem.findByExpenseId.mockResolvedValue([
      { description: 'Coffee beans', amount: 19.99 },
      { description: 'Espresso', amount: 21.99 },
    ]);
  });

  it('normalizes approval review contexts', () => {
    expect(normalizeReviewContext('quick_check')).toBe('review_path_quick_check');
    expect(normalizeReviewContext('items_first')).toBe('review_path_items_first');
    expect(normalizeReviewContext('full_review')).toBe('review_path_full_review');
    expect(normalizeReviewContext('other')).toBeNull();
  });

  it('records clean item review feedback for item-first approvals with unchanged items', async () => {
    const result = await handleApprovedExpenseReview({
      id: 'expense-1',
      user_id: 'user-1',
      source: 'email',
      status: 'confirmed',
      review_mode: 'items_first',
      notes: 'Imported from Gmail (needs review)',
    }, 'user-1', 'items_first');

    expect(EmailImportLog.recordReviewFeedback).toHaveBeenCalledWith('expense-1', {
      action: 'approved',
      changedFields: ['review_path_items_first', 'items_reviewed_clean'],
    });
    expect(result.items).toHaveLength(2);
    expect(result.item_count).toBe(2);
  });

  it('does not mark item review clean when item corrections were already recorded', async () => {
    EmailImportLog.findByExpenseId.mockResolvedValueOnce({
      message_id: 'msg-1',
      review_changed_fields: ['items_amount'],
    });

    await handleApprovedExpenseReview({
      id: 'expense-1',
      user_id: 'user-1',
      source: 'email',
      status: 'confirmed',
      review_mode: 'items_first',
      notes: 'Imported from Gmail',
    }, 'user-1', 'items_first');

    expect(EmailImportLog.recordReviewFeedback).toHaveBeenCalledWith('expense-1', {
      action: 'approved',
      changedFields: ['review_path_items_first'],
    });
  });
});
