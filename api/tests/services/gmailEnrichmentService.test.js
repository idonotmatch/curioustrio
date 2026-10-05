jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/models/expense', () => ({
  findById: jest.fn(),
  updateReviewMetadata: jest.fn(),
}));
jest.mock('../../src/models/expenseItem', () => ({
  findByExpenseId: jest.fn(),
  updateResolution: jest.fn(),
}));
jest.mock('../../src/models/emailImportLog', () => ({ findByExpenseId: jest.fn() }));
jest.mock('../../src/models/user', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/category', () => ({ findByHousehold: jest.fn() }));
jest.mock('../../src/services/productResolver', () => ({ resolveProductMatch: jest.fn() }));
jest.mock('../../src/services/itemHistoryService', () => ({ getItemHistoryByGroupKey: jest.fn() }));
jest.mock('../../src/services/gmailImportQualityService', () => ({
  getSenderImportQuality: jest.fn(),
  recommendReviewMode: jest.fn(),
}));
jest.mock('../../src/services/freshnessEvents', () => ({ emitExpenseFreshnessEvent: jest.fn() }));
jest.mock('../../src/services/projectionRefreshService', () => ({ requestProjectionRefresh: jest.fn() }));
jest.mock('../../src/services/gmailClient', () => ({ getMessage: jest.fn() }));
jest.mock('../../src/services/gmailImporter', () => ({
  buildItemHistoryReviewAdjustment: jest.fn(),
  resolveEmailLocation: jest.fn(),
}));
jest.mock('../../src/services/categoryAssigner', () => ({ assignCategory: jest.fn() }));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const ExpenseItem = require('../../src/models/expenseItem');
const EmailImportLog = require('../../src/models/emailImportLog');
const User = require('../../src/models/user');
const Category = require('../../src/models/category');
const { resolveProductMatch } = require('../../src/services/productResolver');
const { getItemHistoryByGroupKey } = require('../../src/services/itemHistoryService');
const { requestProjectionRefresh } = require('../../src/services/projectionRefreshService');
const { emitExpenseFreshnessEvent } = require('../../src/services/freshnessEvents');
const { getMessage } = require('../../src/services/gmailClient');
const { buildItemHistoryReviewAdjustment, resolveEmailLocation } = require('../../src/services/gmailImporter');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { runGmailEnrichmentJob, stricterReviewMode } = require('../../src/services/gmailEnrichmentService');

describe('gmailEnrichmentService', () => {
  const user = { id: 'user-1', household_id: 'household-1' };
  const expense = {
    id: 'expense-1',
    user_id: 'user-1',
    merchant: 'Whole Foods',
    category_id: 'category-1',
    source: 'email',
    status: 'pending',
    review_required: true,
    review_mode: 'quick_check',
  };
  const item = {
    id: 'item-1',
    expense_id: 'expense-1',
    description: 'Organic Bananas',
    comparable_key: 'organic bananas',
    product_id: null,
    product_match_confidence: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockResolvedValue(user);
    Expense.findById.mockResolvedValue(expense);
    Expense.updateReviewMetadata.mockResolvedValue({ ...expense, review_mode: 'items_first' });
    EmailImportLog.findByExpenseId.mockResolvedValue({
      message_id: 'message-1',
      subject: 'Your receipt',
      from_address: 'receipts@wholefoods.com',
      snippet: 'Total $4.29',
    });
    ExpenseItem.findByExpenseId.mockResolvedValue([item]);
    resolveProductMatch.mockResolvedValue({
      product_id: 'product-1',
      confidence: 'medium',
      reason: 'normalized_match',
    });
    ExpenseItem.updateResolution.mockResolvedValue({
      ...item,
      product_id: 'product-1',
      product_match_confidence: 'medium',
      product_match_reason: 'normalized_match',
    });
    getItemHistoryByGroupKey.mockResolvedValue(null);
    buildItemHistoryReviewAdjustment.mockReturnValue(null);
    getMessage.mockResolvedValue({ body: 'Pickup at 123 Market Street' });
    resolveEmailLocation.mockResolvedValue({ modality: 'pickup', location: null });
    requestProjectionRefresh.mockResolvedValue(null);
    emitExpenseFreshnessEvent.mockResolvedValue(null);
    db.query.mockResolvedValue({ rows: [] });
    Category.findByHousehold.mockResolvedValue([]);
    assignCategory.mockResolvedValue({ category_id: null });
  });

  it('matches items after persistence and tightens review for uncertain candidates', async () => {
    const result = await runGmailEnrichmentJob({ user_id: user.id, expense_id: expense.id });

    expect(resolveProductMatch).toHaveBeenCalledWith(item, expense.merchant, {
      householdId: user.household_id,
    });
    expect(ExpenseItem.updateResolution).toHaveBeenCalledWith(item.id, expense.id, {
      productId: 'product-1',
      productMatchConfidence: 'medium',
      productMatchReason: 'normalized_match',
    });
    expect(Expense.updateReviewMetadata).toHaveBeenCalledWith(expense.id, user.id, expect.objectContaining({
      reviewMode: 'items_first',
    }));
    expect(requestProjectionRefresh).toHaveBeenCalled();
    expect(emitExpenseFreshnessEvent).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ resolved_item_count: 1, review_mode: 'items_first' }));
  });

  it('does not overwrite an item that was already enriched or reviewed', async () => {
    ExpenseItem.findByExpenseId.mockResolvedValue([{
      ...item,
      product_id: 'product-1',
      product_match_confidence: 'high',
      product_match_reason: 'user_confirmed_match',
    }]);

    await runGmailEnrichmentJob({ user_id: user.id, expense_id: expense.id });

    expect(resolveProductMatch).not.toHaveBeenCalled();
    expect(ExpenseItem.updateResolution).not.toHaveBeenCalled();
  });

  it('fills a deferred category only while the expense remains uncategorized', async () => {
    Expense.findById.mockResolvedValue({ ...expense, category_id: null });
    Category.findByHousehold.mockResolvedValue([{ id: 'category-2', name: 'Groceries' }]);
    assignCategory.mockResolvedValue({
      category_id: 'category-2',
      source: 'claude',
      confidence: 1,
      reasoning: { strategy: 'claude' },
    });
    db.query.mockResolvedValueOnce({ rows: [{ id: expense.id }] });

    const result = await runGmailEnrichmentJob({ user_id: user.id, expense_id: expense.id });

    expect(assignCategory).toHaveBeenCalledWith(expect.objectContaining({
      allowDeferredFallback: true,
      householdId: user.household_id,
    }));
    expect(db.query.mock.calls[0][0]).toContain('AND category_id IS NULL');
    expect(result.category_enriched).toBe(true);
  });

  it('can make review stricter without downgrading a path already in use', () => {
    expect(stricterReviewMode('quick_check', 'items_first')).toBe('items_first');
    expect(stricterReviewMode('items_first', 'full_review')).toBe('full_review');
    expect(stricterReviewMode('items_first', 'quick_check')).toBe('items_first');
    expect(stricterReviewMode('full_review', 'items_first')).toBe('full_review');
  });
});
