jest.mock('../../src/models/expense', () => ({
  findPotentialDuplicates: jest.fn(),
  findByMapkitStableId: jest.fn(),
}));
jest.mock('../../src/models/duplicateFlag', () => ({ create: jest.fn() }));

const Expense = require('../../src/models/expense');
const DuplicateFlag = require('../../src/models/duplicateFlag');
const detectDuplicates = require('../../src/services/duplicateDetector');
const { scoreCandidate } = require('../../src/services/duplicateDetector');

beforeEach(() => {
  jest.resetAllMocks();
  Expense.findPotentialDuplicates.mockResolvedValue([]);
  Expense.findByMapkitStableId.mockResolvedValue([]);
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
