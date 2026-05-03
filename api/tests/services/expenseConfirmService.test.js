jest.mock('../../src/models/expense');
jest.mock('../../src/models/category');
jest.mock('../../src/models/merchantMapping');
jest.mock('../../src/models/expenseItem');
jest.mock('../../src/models/ingestAttemptLog');
jest.mock('../../src/models/categoryDecisionEvent');
jest.mock('../../src/models/receiptLineCorrection');
jest.mock('../../src/services/duplicateDetector');
jest.mock('../../src/services/productResolver');
jest.mock('../../src/services/categoryAssigner');
jest.mock('../../src/services/mapkitService');

const Expense = require('../../src/models/expense');
const Category = require('../../src/models/category');
const MerchantMapping = require('../../src/models/merchantMapping');
const ExpenseItem = require('../../src/models/expenseItem');
const IngestAttemptLog = require('../../src/models/ingestAttemptLog');
const CategoryDecisionEvent = require('../../src/models/categoryDecisionEvent');
const ReceiptLineCorrection = require('../../src/models/receiptLineCorrection');
const detectDuplicates = require('../../src/services/duplicateDetector');
const { resolveProductMatch } = require('../../src/services/productResolver');
const { assignCategory } = require('../../src/services/categoryAssigner');
const { searchPlace } = require('../../src/services/mapkitService');
const {
  createConfirmedExpense,
  resolveDeferredConfirmPayload,
} = require('../../src/services/expenseConfirmService');

describe('expenseConfirmService deferred enrichment', () => {
  beforeEach(() => {
    Expense.create.mockReset();
    Category.findByHousehold.mockReset();
    MerchantMapping.upsert.mockReset();
    ExpenseItem.createBulk.mockReset();
    IngestAttemptLog.findByIdForUser.mockReset();
    IngestAttemptLog.appendPaymentFeedback.mockReset();
    IngestAttemptLog.markConfirmed.mockReset();
    CategoryDecisionEvent.create.mockReset();
    ReceiptLineCorrection.upsert.mockReset();
    detectDuplicates.mockReset();
    resolveProductMatch.mockReset();
    assignCategory.mockReset();
    searchPlace.mockReset();

    Expense.create.mockImplementation(async (args) => ({
      id: 'expense-1',
      household_id: args.householdId,
      merchant: args.merchant,
      amount: args.amount,
      date: args.date,
      category_id: args.categoryId,
      place_name: args.placeName,
      address: args.address,
      mapkit_stable_id: args.mapkitStableId,
      status: 'confirmed',
    }));
    Category.findByHousehold.mockResolvedValue([{ id: 'cat-1', name: 'Dining Out' }]);
    ExpenseItem.createBulk.mockResolvedValue(undefined);
    MerchantMapping.upsert.mockResolvedValue(undefined);
    IngestAttemptLog.findByIdForUser.mockResolvedValue(null);
    IngestAttemptLog.appendPaymentFeedback.mockResolvedValue(undefined);
    IngestAttemptLog.markConfirmed.mockResolvedValue(undefined);
    CategoryDecisionEvent.create.mockResolvedValue(undefined);
    ReceiptLineCorrection.upsert.mockResolvedValue(undefined);
    detectDuplicates.mockResolvedValue([]);
    resolveProductMatch.mockResolvedValue(null);
    assignCategory.mockResolvedValue({
      category_id: 'cat-1',
      source: 'claude',
      confidence: 1,
      reasoning: { strategy: 'claude' },
    });
    searchPlace.mockResolvedValue({
      place_name: 'Whole Foods Market',
      address: '123 Main St',
      mapkit_stable_id: 'place-1',
    });
  });

  it('resolves deferred category on confirm when the user did not choose one', async () => {
    const payload = await resolveDeferredConfirmPayload({
      user: { id: 'user-1', household_id: 'hh-1' },
      payload: {
        merchant: 'Coffee Bar',
        description: 'coffee',
        amount: 6.5,
        date: '2026-05-02',
        source: 'manual',
        category_id: null,
        category_status: 'deferred',
        category_user_owned: false,
      },
    });

    expect(Category.findByHousehold).toHaveBeenCalledWith('hh-1');
    expect(assignCategory).toHaveBeenCalledWith(expect.objectContaining({
      merchant: 'Coffee Bar',
      description: 'coffee',
      householdId: 'hh-1',
      allowDeferredFallback: true,
    }));
    expect(payload).toMatchObject({
      category_id: 'cat-1',
      category_source: 'claude',
      category_status: 'assigned',
    });
  });

  it('does not resolve deferred category when the user explicitly leaves it unassigned', async () => {
    const result = await createConfirmedExpense({
      user: { id: 'user-1', household_id: 'hh-1' },
      payload: {
        merchant: 'Coffee Bar',
        description: 'coffee',
        amount: 6.5,
        date: '2026-05-02',
        source: 'manual',
        category_id: null,
        category_status: 'deferred',
        category_user_owned: true,
      },
    });

    expect(assignCategory).not.toHaveBeenCalled();
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: null,
    }));
    expect(result.expense.category_id).toBeNull();
  });

  it('resolves deferred location on confirm when the user did not touch location', async () => {
    await createConfirmedExpense({
      user: { id: 'user-1', household_id: 'hh-1' },
      payload: {
        merchant: 'Whole Foods',
        description: 'groceries',
        amount: 19.84,
        date: '2026-04-27',
        source: 'camera',
        category_id: 'cat-1',
        category_status: 'assigned',
        category_user_owned: false,
        place_name: 'Whole Foods',
        address: '123 Main St',
        mapkit_stable_id: null,
        location_status: 'deferred',
        location_user_owned: false,
      },
    });

    expect(searchPlace).toHaveBeenCalledWith('Whole Foods 123 Main St');
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      placeName: 'Whole Foods Market',
      address: '123 Main St',
      mapkitStableId: 'place-1',
    }));
  });

  it('does not overwrite a manually chosen location during deferred enrichment', async () => {
    await createConfirmedExpense({
      user: { id: 'user-1', household_id: 'hh-1' },
      payload: {
        merchant: 'Whole Foods',
        description: 'groceries',
        amount: 19.84,
        date: '2026-04-27',
        source: 'camera',
        category_id: 'cat-1',
        category_status: 'assigned',
        category_user_owned: false,
        place_name: 'My custom place',
        address: '789 User Way',
        mapkit_stable_id: null,
        location_status: 'deferred',
        location_user_owned: true,
      },
    });

    expect(searchPlace).not.toHaveBeenCalled();
    expect(Expense.create).toHaveBeenCalledWith(expect.objectContaining({
      placeName: 'My custom place',
      address: '789 User Way',
      mapkitStableId: null,
    }));
  });
});
