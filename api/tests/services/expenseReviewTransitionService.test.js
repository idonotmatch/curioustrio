jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/models/expense', () => ({ findById: jest.fn() }));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const { transitionPendingExpense } = require('../../src/services/expenseReviewTransitionService');

describe('pending expense review transitions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('atomically confirms a pending expense while checking duplicate flags', async () => {
    const expense = { id: 'expense-1', user_id: 'user-1', status: 'confirmed' };
    db.query.mockResolvedValue({ rows: [expense] });

    await expect(transitionPendingExpense('expense-1', 'user-1', 'confirmed', {
      blockPendingDuplicates: true,
    })).resolves.toEqual({ expense, idempotentReplay: false });

    expect(db.query.mock.calls[0][0]).toContain("e.status = 'pending'");
    expect(db.query.mock.calls[0][0]).toContain('duplicate_flags');
    expect(db.query.mock.calls[0][1]).toEqual(['expense-1', 'user-1', 'confirmed', true]);
  });

  it('treats a repeated transition to the same state as an idempotent replay', async () => {
    const expense = { id: 'expense-1', user_id: 'user-1', status: 'dismissed' };
    db.query.mockResolvedValue({ rows: [] });
    Expense.findById.mockResolvedValue(expense);

    await expect(transitionPendingExpense('expense-1', 'user-1', 'dismissed')).resolves.toEqual({
      expense,
      idempotentReplay: true,
    });
  });

  it('blocks approval while a duplicate remains unresolved', async () => {
    db.query.mockResolvedValue({ rows: [] });
    Expense.findById.mockResolvedValue({ id: 'expense-1', user_id: 'user-1', status: 'pending' });

    await expect(transitionPendingExpense('expense-1', 'user-1', 'confirmed', {
      blockPendingDuplicates: true,
    })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/duplicate/i) });
  });

  it('does not let a stale request reverse a completed review', async () => {
    db.query.mockResolvedValue({ rows: [] });
    Expense.findById.mockResolvedValue({ id: 'expense-1', user_id: 'user-1', status: 'confirmed' });

    await expect(transitionPendingExpense('expense-1', 'user-1', 'dismissed'))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already been reviewed/i) });
  });

  it('does not reveal another user\'s expense', async () => {
    db.query.mockResolvedValue({ rows: [] });
    Expense.findById.mockResolvedValue({ id: 'expense-1', user_id: 'user-2', status: 'pending' });

    await expect(transitionPendingExpense('expense-1', 'user-1', 'confirmed'))
      .rejects.toMatchObject({ status: 404 });
  });
});
