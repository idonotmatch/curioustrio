jest.mock('../../src/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

const Expense = require('../../src/models/expense');
const ExpenseItem = require('../../src/models/expenseItem');

describe('expense transaction boundaries', () => {
  it('uses the caller transaction for expense updates', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'expense-1', merchant: 'Updated' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(Expense.update('expense-1', 'user-1', {
      merchant: 'Updated',
      queryable: client,
    })).resolves.toMatchObject({ id: 'expense-1', merchant: 'Updated' });

    expect(client.query).toHaveBeenNthCalledWith(1, 'SAVEPOINT expense_update_compat');
    expect(client.query.mock.calls[1][0]).toContain('UPDATE expenses SET');
    expect(client.query).toHaveBeenLastCalledWith('RELEASE SAVEPOINT expense_update_compat');
  });

  it('does not commit or release a transaction owned by the route', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'item-1', description: 'Milk' }] }),
      release: jest.fn(),
    };

    await expect(ExpenseItem.replaceItems('expense-1', [
      { description: 'Milk', amount: 4.25 },
    ], client)).resolves.toEqual([{ id: 'item-1', description: 'Milk' }]);

    expect(client.query.mock.calls[0][0]).toContain('DELETE FROM expense_items');
    expect(client.query.mock.calls[1][0]).toContain('INSERT INTO expense_items');
    expect(client.query).not.toHaveBeenCalledWith('BEGIN');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).not.toHaveBeenCalled();
  });
});
