jest.mock('../../src/models/expense', () => ({
  findById: jest.fn(),
  findPotentialDuplicates: jest.fn(),
  findByMapkitStableId: jest.fn(),
  findByPlaceEntityId: jest.fn(),
}));
jest.mock('../../src/models/duplicateFlag', () => ({ create: jest.fn() }));
jest.mock('../../src/models/expenseItem', () => ({ findByExpenseId: jest.fn() }));
jest.mock('../../src/models/expenseReceiptDetail', () => ({
  findByExpenseId: jest.fn(),
  findPotentialDuplicates: jest.fn(),
}));
jest.mock('../../src/models/expenseSourceObservation', () => ({
  findTransactionIdsForExpense: jest.fn(),
  findPotentialTransactionDuplicates: jest.fn(),
}));
jest.mock('../../src/models/matchDecision', () => ({
  isExpensePairDifferent: jest.fn(),
  isDuplicatePatternDifferent: jest.fn(),
}));

const Expense = require('../../src/models/expense');
const DuplicateFlag = require('../../src/models/duplicateFlag');
const ExpenseItem = require('../../src/models/expenseItem');
const ExpenseReceiptDetail = require('../../src/models/expenseReceiptDetail');
const ExpenseSourceObservation = require('../../src/models/expenseSourceObservation');
const MatchDecision = require('../../src/models/matchDecision');
const detectDuplicates = require('../../src/services/duplicateDetector');
const { scoreCandidate } = require('../../src/services/duplicateDetector');

beforeEach(() => {
  jest.resetAllMocks();
  Expense.findPotentialDuplicates.mockResolvedValue([]);
  Expense.findById.mockResolvedValue(null);
  Expense.findByMapkitStableId.mockResolvedValue([]);
  Expense.findByPlaceEntityId.mockResolvedValue([]);
  ExpenseItem.findByExpenseId.mockResolvedValue([]);
  ExpenseReceiptDetail.findByExpenseId.mockResolvedValue(null);
  ExpenseReceiptDetail.findPotentialDuplicates.mockResolvedValue([]);
  ExpenseSourceObservation.findTransactionIdsForExpense.mockResolvedValue([]);
  ExpenseSourceObservation.findPotentialTransactionDuplicates.mockResolvedValue([]);
  MatchDecision.isExpensePairDifferent.mockResolvedValue(false);
  MatchDecision.isDuplicatePatternDifferent.mockResolvedValue(false);
});

it('downgrades future matches after a similar pattern was kept separate', async () => {
  const candidate = { id: 'expense-1', source: 'manual', merchant: 'Coffee Shop', amount: '8.00', date: '2026-09-02' };
  Expense.findPotentialDuplicates.mockResolvedValue([candidate]);
  MatchDecision.isDuplicatePatternDifferent.mockResolvedValue(true);
  DuplicateFlag.create.mockImplementation(async (value) => value);

  await detectDuplicates({
    id: 'expense-2', user_id: 'user-1', source: 'email', merchant: 'Coffee Shop', amount: '8.00', date: '2026-09-02',
  });

  expect(DuplicateFlag.create).toHaveBeenCalledWith(expect.objectContaining({
    confidence: 'fuzzy',
    score: 75,
    matchReasons: expect.arrayContaining(['Similar matches were previously kept separate']),
  }));
});

it('does not recreate a duplicate that the user marked as different', async () => {
  const candidate = { id: 'expense-1', merchant: 'Coffee Shop', amount: '8.00', date: '2026-09-02' };
  Expense.findPotentialDuplicates.mockResolvedValue([candidate]);
  MatchDecision.isExpensePairDifferent.mockResolvedValue(true);

  const flags = await detectDuplicates({
    id: 'expense-2', user_id: 'user-1', merchant: 'Coffee Shop', amount: '8.00', date: '2026-09-02',
  });

  expect(flags).toEqual([]);
  expect(DuplicateFlag.create).not.toHaveBeenCalled();
});

it('scores exact matches with readable evidence', () => {
  expect(scoreCandidate(
    { merchant: 'Whole Foods', amount: 19.84, date: '2026-09-01', card_last4: '1234' },
    { merchant: 'whole-foods', amount: '19.84', date: '2026-09-01', card_last4: '1234' }
  )).toEqual({
    score: 115,
    confidence: 'exact',
    reasons: ['Same merchant', 'Same amount', 'Same date', 'Same card'],
  });
});

it('treats a matching receipt transaction ID as exact evidence', () => {
  expect(scoreCandidate(
    { merchant: 'Target', amount: 20, date: '2026-09-01' },
    { merchant: 'Target', amount: 21, date: '2026-09-02' },
    { transactionIdMatch: true }
  )).toEqual({
    score: 170,
    confidence: 'exact',
    reasons: ['Same merchant', 'Amount within $1', 'Dates one day apart', 'Same receipt transaction ID'],
  });
});

it('uses stable merchant and payment identities when display text changes', () => {
  expect(scoreCandidate(
    {
      merchant: 'Neighborhood Market',
      merchant_entity_id: 'merchant-1',
      payment_instrument_id: 'payment-1',
      amount: 20,
      date: '2026-09-01',
    },
    {
      merchant: 'Market Receipt Header',
      merchant_entity_id: 'merchant-1',
      payment_instrument_id: 'payment-1',
      amount: 20,
      date: '2026-09-01',
    }
  )).toEqual({
    score: 115,
    confidence: 'exact',
    reasons: ['Same merchant', 'Same amount', 'Same date', 'Same payment method'],
  });
});

it('detects duplicates for users without a household', async () => {
  const candidate = { id: 'expense-1', merchant: 'Target', amount: '20.00', date: '2026-09-02' };
  Expense.findPotentialDuplicates.mockResolvedValue([candidate]);
  DuplicateFlag.create.mockResolvedValue({ id: 'flag-1', confidence: 'exact' });

  const flags = await detectDuplicates({
    id: 'expense-2',
    user_id: 'user-1',
    household_id: null,
    merchant: 'Target',
    amount: '20.00',
    date: '2026-09-02',
  });

  expect(Expense.findPotentialDuplicates).toHaveBeenCalledWith(expect.objectContaining({
    householdId: null,
    userId: 'user-1',
  }));
  expect(DuplicateFlag.create).toHaveBeenCalledWith(expect.objectContaining({
    expenseIdA: 'expense-2',
    expenseIdB: 'expense-1',
    confidence: 'exact',
    score: 100,
    matchReasons: ['Same merchant', 'Same amount', 'Same date'],
  }));
  expect(flags).toHaveLength(1);
});

it('uses basket overlap to connect OCR merchant variants', async () => {
  const candidate = { id: 'expense-1', merchant: 'Bobby Boy Bakeshop', amount: '20.00', date: '2026-09-02' };
  Expense.findPotentialDuplicates.mockResolvedValue([candidate]);
  ExpenseItem.findByExpenseId
    .mockResolvedValueOnce([{ comparable_key: 'croissant' }, { comparable_key: 'sourdough' }])
    .mockResolvedValueOnce([{ comparable_key: 'croissant' }, { comparable_key: 'sourdough' }]);
  DuplicateFlag.create.mockResolvedValue({ id: 'flag-1', confidence: 'fuzzy' });

  await detectDuplicates({
    id: 'expense-2',
    user_id: 'user-1',
    merchant: 'Bobby Boy Bake Shop Let us know how your visit went',
    amount: '20.00',
    date: '2026-09-02',
  });

  expect(DuplicateFlag.create).toHaveBeenCalledWith(expect.objectContaining({
    score: 135,
    matchReasons: expect.arrayContaining(['Same basket (100%)']),
  }));
});
