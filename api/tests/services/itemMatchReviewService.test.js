jest.mock('../../src/db', () => ({
  pool: { connect: jest.fn() },
}));
jest.mock('../../src/models/expense', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/expenseItem', () => ({
  findByIdForExpense: jest.fn(),
  updateResolution: jest.fn(),
  applyConfirmedAlias: jest.fn(),
}));
jest.mock('../../src/models/itemMatchDecision', () => ({ upsert: jest.fn() }));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const ExpenseItem = require('../../src/models/expenseItem');
const ItemMatchDecision = require('../../src/models/itemMatchDecision');
const { recordItemMatchDecision } = require('../../src/services/itemMatchReviewService');

describe('itemMatchReviewService', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  const user = { id: 'user-1', household_id: 'household-1' };
  const expense = { id: 'expense-1', user_id: 'user-1', merchant: 'Whole Foods' };
  const item = {
    id: 'item-1',
    expense_id: 'expense-1',
    observation_key: 'observation-1',
    description: 'Organic Bananas',
    normalized_name: 'organic bananas',
    product_id: 'product-1',
    product_match_confidence: 'medium',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    db.pool.connect.mockResolvedValue(client);
    client.query.mockResolvedValue({ rows: [] });
    Expense.findById.mockResolvedValue(expense);
    ExpenseItem.findByIdForExpense.mockResolvedValue(item);
    ItemMatchDecision.upsert.mockResolvedValue({ id: 'decision-1' });
    ExpenseItem.updateResolution.mockResolvedValue({ ...item, product_match_confidence: 'high' });
    ExpenseItem.applyConfirmedAlias.mockResolvedValue(2);
  });

  it('promotes a confirmed candidate and stores household memory atomically', async () => {
    await recordItemMatchDecision({
      user,
      expenseId: expense.id,
      itemId: item.id,
      decision: 'same',
    });

    expect(ItemMatchDecision.upsert).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'household-1',
      candidateProductId: 'product-1',
      decision: 'same',
    }), client);
    expect(ExpenseItem.updateResolution).toHaveBeenCalledWith(item.id, expense.id, {
      productId: 'product-1',
      productMatchConfidence: 'high',
      productMatchReason: 'user_confirmed_match',
    }, client);
    expect(ExpenseItem.applyConfirmedAlias).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'household-1',
      normalizedName: 'organic banana',
      merchant: 'Whole Foods',
      productId: 'product-1',
    }), client);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('clears a rejected candidate while retaining the rejection in memory', async () => {
    await recordItemMatchDecision({
      user,
      expenseId: expense.id,
      itemId: item.id,
      decision: 'different',
    });

    expect(ItemMatchDecision.upsert).toHaveBeenCalledWith(expect.objectContaining({ decision: 'different' }), client);
    expect(ExpenseItem.updateResolution).toHaveBeenCalledWith(item.id, expense.id, {
      productId: null,
      productMatchConfidence: null,
      productMatchReason: 'user_rejected_match',
    }, client);
    expect(ExpenseItem.applyConfirmedAlias).not.toHaveBeenCalled();
  });

  it('refuses stale decisions after a candidate has already been resolved', async () => {
    ExpenseItem.findByIdForExpense.mockResolvedValue({ ...item, product_match_confidence: 'high' });

    await expect(recordItemMatchDecision({
      user,
      expenseId: expense.id,
      itemId: item.id,
      decision: 'same',
    })).rejects.toMatchObject({ status: 409 });
    expect(ItemMatchDecision.upsert).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
