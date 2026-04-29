jest.mock('../../src/db', () => ({
  pool: {
    connect: jest.fn(),
  },
}));

const db = require('../../src/db');
const { deleteAccountDataForUser } = require('../../src/services/accountDeletionService');

describe('deleteAccountDataForUser', () => {
  let client;

  beforeEach(() => {
    client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(client);
  });

  it('returns null when the user does not exist', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql.includes('FROM users')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAccountDataForUser('missing-user')).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('removes user-owned data and cleans up an empty household', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id, household_id')) {
        return { rows: [{ id: 'user-1', household_id: 'household-1' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM expenses')) {
        return { rows: [{ id: 'expense-1' }, { id: 'expense-2' }], rowCount: 2 };
      }
      if (sql.includes('SELECT COUNT(*)::int AS count')) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAccountDataForUser('user-1')).resolves.toEqual({
      deleted: true,
      user_id: 'user-1',
      household_id: 'household-1',
      expense_count: 2,
    });

    const executedSql = client.query.mock.calls.map(([sql]) => sql);
    expect(executedSql).toEqual(expect.arrayContaining([
      expect.stringContaining('DELETE FROM push_tokens'),
      expect.stringContaining('DELETE FROM oauth_tokens'),
      expect.stringContaining('DELETE FROM email_import_log'),
      expect.stringContaining('DELETE FROM expenses'),
      expect.stringContaining('DELETE FROM users'),
      expect.stringContaining('DELETE FROM households'),
    ]));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});
