jest.mock('../../src/db', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/models/expense', () => ({
  findTreatmentCandidates: jest.fn(),
}));

jest.mock('../../src/models/duplicateFlag', () => ({
  findByExpenseId: jest.fn(),
}));

jest.mock('../../src/models/expenseItem', () => ({
  findByExpenseId: jest.fn(),
}));

jest.mock('../../src/models/emailImportLog', () => ({
  findByExpenseId: jest.fn(),
}));

jest.mock('../../src/services/gmailImportQualityService', () => ({
  getSenderImportQuality: jest.fn(),
  recommendReviewMode: jest.fn(),
}));

jest.mock('../../src/services/itemHistoryService', () => ({
  getItemHistoryByGroupKey: jest.fn(),
}));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const DuplicateFlag = require('../../src/models/duplicateFlag');
const ExpenseItem = require('../../src/models/expenseItem');
const EmailImportLog = require('../../src/models/emailImportLog');
const { getSenderImportQuality, recommendReviewMode } = require('../../src/services/gmailImportQualityService');
const { getItemHistoryByGroupKey } = require('../../src/services/itemHistoryService');
const {
  fetchPendingExpensesBase,
  attachExpenseReviewContext,
  attachExpensesReviewContext,
} = require('../../src/services/expenseReviewContext');

describe('expenseReviewContext', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    recommendReviewMode.mockReturnValue('full_review');
    getSenderImportQuality.mockResolvedValue({
      level: 'trusted',
      sender_domain: 'amazon.com',
      metrics: {},
      item_reliability: { level: 'unknown', message: null, top_signals: [] },
      top_changed_fields: [],
      review_path_reliability: { fast_lane_eligible: true },
    });
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
  });

  it('fetches pending expense base rows', async () => {
    const rows = [{ id: 'expense-1', merchant: 'Amazon', status: 'pending' }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(fetchPendingExpensesBase('user-1')).resolves.toEqual(rows);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE e.user_id = $1 AND e.status = \'pending\''),
      ['user-1']
    );
  });

  it('attaches Gmail review context with treatment suggestion, duplicate flags, and items', async () => {
    const expense = {
      id: 'expense-1',
      user_id: 'user-1',
      merchant: 'Uber',
      description: 'Airport ride',
      amount: 42.5,
      date: '2026-03-16',
      source: 'email',
      status: 'pending',
      review_mode: 'quick_check',
      review_source: 'gmail',
      category_id: 'travel-cat',
      notes: 'Ride receipt',
    };

    DuplicateFlag.findByExpenseId.mockResolvedValueOnce([{ id: 'dup-1', confidence: 'low' }]);
    ExpenseItem.findByExpenseId.mockResolvedValueOnce([{ description: 'Airport ride', amount: 42.5 }]);
    EmailImportLog.findByExpenseId.mockResolvedValueOnce({
      message_id: 'gmail-msg-1',
      subject: 'Uber trip &quot;receipt&quot;',
      snippet: 'Your Uber trip total was &quot;$42.50&quot;',
      from_address: 'uber@uber.com',
      imported_at: '2026-03-16T14:00:00.000Z',
      review_action: null,
    });
    Expense.findTreatmentCandidates.mockResolvedValueOnce([
      {
        id: 'hist-1',
        merchant: 'Uber',
        description: 'Airport ride',
        amount: 38,
        category_id: 'travel-cat',
        category_name: 'Travel',
        payment_method: 'credit',
        card_label: 'Chase Sapphire',
        card_last4: '4242',
        is_private: false,
        exclude_from_budget: true,
        budget_exclusion_reason: 'business',
      },
      {
        id: 'hist-2',
        merchant: 'Uber',
        description: 'Airport ride',
        amount: 47,
        category_id: 'travel-cat',
        category_name: 'Travel',
        payment_method: 'credit',
        card_label: 'Chase Sapphire',
        card_last4: '4242',
        is_private: false,
        exclude_from_budget: true,
        budget_exclusion_reason: 'business',
      },
    ]);
    getItemHistoryByGroupKey.mockResolvedValueOnce(null);

    const result = await attachExpenseReviewContext(expense, 'user-1', { includeItems: true });

    expect(result.duplicate_flags).toEqual([{ id: 'dup-1', confidence: 'low' }]);
    expect(result.items).toEqual([{ description: 'Airport ride', amount: 42.5 }]);
    expect(result.gmail_review_hint).toMatchObject({
      sender_domain: 'amazon.com',
      from_address: 'uber@uber.com',
      message_subject: 'Uber trip "receipt"',
      message_snippet: 'Your Uber trip total was "$42.50"',
      review_mode: 'quick_check',
      treatment_suggestion: expect.objectContaining({
        suggested_track_only: true,
        budget_exclusion_reason: 'business',
        suggested_category_name: 'Travel',
        suggested_payment_method: 'credit',
        suggested_card_label: 'Chase Sapphire',
        suggested_card_last4: '4242',
      }),
    });
    expect(result.email_subject).toBe('Uber trip "receipt"');
    expect(result.email_snippet).toBe('Your Uber trip total was "$42.50"');
  });

  it('attaches compact item history context when expense items have stable identities', async () => {
    const expense = {
      id: 'expense-3',
      user_id: 'user-1',
      household_id: 'household-1',
      merchant: 'Target',
      amount: 14.99,
      source: 'manual',
      status: 'confirmed',
    };

    DuplicateFlag.findByExpenseId.mockResolvedValueOnce([]);
    ExpenseItem.findByExpenseId.mockResolvedValueOnce([
      {
        description: 'Paper Towels',
        amount: 14.99,
        comparable_key: 'paper towel|brand:bounty',
      },
    ]);
    getItemHistoryByGroupKey.mockResolvedValueOnce({
      group_key: 'comparable:paper towel|brand:bounty',
      item_name: 'Paper Towels',
      brand: 'Bounty',
      occurrence_count: 3,
      average_gap_days: 12,
      median_amount: 13.99,
      median_unit_price: null,
      normalized_total_size_unit: null,
      last_purchased_at: '2026-04-10',
      merchants: ['Target', 'Costco'],
      merchant_breakdown: [
        { merchant: 'Target', occurrence_count: 2, median_amount: 13.49 },
        { merchant: 'Costco', occurrence_count: 1, median_amount: 15.99 },
      ],
      purchases: [
        { date: '2026-03-15', merchant: 'Target', amount: 13.49 },
        { date: '2026-03-27', merchant: 'Costco', amount: 15.99 },
        { date: '2026-04-10', merchant: 'Target', amount: 14.99 },
      ],
    });

    const result = await attachExpenseReviewContext(expense, 'user-1', { includeItems: true });

    expect(getItemHistoryByGroupKey).toHaveBeenCalledWith(
      'user-1',
      'comparable:paper towel|brand:bounty',
      { scope: 'personal', lookbackDays: 180 }
    );
    expect(result.item_review_context).toEqual([
      expect.objectContaining({
        group_key: 'comparable:paper towel|brand:bounty',
        item_name: 'Paper Towels',
        occurrence_count: 3,
        average_gap_days: 12,
        median_amount: 13.99,
        latest_purchase: expect.objectContaining({
          merchant: 'Target',
          amount: 14.99,
        }),
      }),
    ]);
    expect(result.gmail_review_hint).toBeUndefined();
  });

  it('keeps item history on the expense while leaving Gmail review hints focused on verification', async () => {
    const expense = {
      id: 'expense-4',
      user_id: 'user-1',
      household_id: 'household-1',
      merchant: 'Whole Foods',
      amount: 18.49,
      source: 'email',
      status: 'pending',
      review_source: 'gmail',
    };

    DuplicateFlag.findByExpenseId.mockResolvedValueOnce([]);
    ExpenseItem.findByExpenseId.mockResolvedValueOnce([
      {
        description: 'Sparkling Water',
        amount: 18.49,
        comparable_key: 'sparkling water|brand:water co',
      },
    ]);
    EmailImportLog.findByExpenseId.mockResolvedValueOnce({
      message_id: 'gmail-msg-4',
      subject: 'Your receipt from Whole Foods',
      snippet: 'Total $18.49',
      from_address: 'receipts@wholefoods.com',
      imported_at: '2026-04-16T14:00:00.000Z',
      review_action: null,
    });
    Expense.findTreatmentCandidates.mockResolvedValueOnce([]);
    getItemHistoryByGroupKey.mockResolvedValueOnce({
      group_key: 'comparable:sparkling water|brand:water co',
      item_name: 'Sparkling Water',
      brand: 'Water Co',
      occurrence_count: 3,
      average_gap_days: 10,
      median_amount: 17.99,
      median_unit_price: null,
      normalized_total_size_unit: null,
      last_purchased_at: '2026-04-12',
      merchants: ['Target', 'Whole Foods'],
      merchant_breakdown: [],
      purchases: [
        { date: '2026-03-20', merchant: 'Target', amount: 17.49 },
        { date: '2026-04-01', merchant: 'Target', amount: 18.09 },
        { date: '2026-04-12', merchant: 'Target', amount: 18.39 },
      ],
    });

    const result = await attachExpenseReviewContext(expense, 'user-1', { includeItems: true });

    expect(result.item_review_context).toEqual([
      expect.objectContaining({
        group_key: 'comparable:sparkling water|brand:water co',
        item_name: 'Sparkling Water',
        occurrence_count: 3,
      }),
    ]);
    expect(result.gmail_review_hint).toEqual(expect.not.objectContaining({
      item_review_signals: expect.anything(),
    }));
  });

  it('keeps core expense data when Gmail hint attachment fails', async () => {
    const expense = {
      id: 'expense-2',
      merchant: 'Amazon',
      amount: 19.99,
      source: 'email',
      status: 'pending',
    };

    DuplicateFlag.findByExpenseId.mockRejectedValueOnce(new Error('missing duplicate table'));
    EmailImportLog.findByExpenseId.mockRejectedValueOnce(new Error('gmail log exploded'));

    const result = await attachExpenseReviewContext(expense, 'user-1');

    expect(result.duplicate_flags).toEqual([]);
    expect(result.gmail_review_hint).toBeNull();
    expect(result.id).toBe('expense-2');
  });

  it('falls back per expense when bulk enrichment fails', async () => {
    DuplicateFlag.findByExpenseId
      .mockResolvedValueOnce([{ id: 'dup-a' }])
      .mockRejectedValueOnce(new Error('duplicate failed'));
    EmailImportLog.findByExpenseId
      .mockResolvedValueOnce({
        message_id: 'msg-a',
        subject: 'Receipt A',
        snippet: 'Total $10.00',
        from_address: 'orders@amazon.com',
        imported_at: '2026-03-16T14:00:00.000Z',
        review_action: null,
      })
      .mockRejectedValueOnce(new Error('log failed'));
    Expense.findTreatmentCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const results = await attachExpensesReviewContext([
      { id: 'expense-a', merchant: 'Amazon', amount: 10, source: 'email', status: 'pending' },
      { id: 'expense-b', merchant: 'Target', amount: 20, source: 'email', status: 'pending' },
    ], 'user-1');

    expect(results).toHaveLength(2);
    expect(results[0].duplicate_flags).toEqual([{ id: 'dup-a' }]);
    expect(results[0].gmail_review_hint).toMatchObject({
      message_subject: 'Receipt A',
      message_snippet: 'Total $10.00',
    });
    expect(results[1].duplicate_flags).toEqual([]);
    expect(results[1].gmail_review_hint).toBeNull();
  });
});
