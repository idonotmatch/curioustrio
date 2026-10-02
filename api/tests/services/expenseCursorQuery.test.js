jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const Expense = require('../../src/models/expense');

describe('Expense cursor queries', () => {
  const cursor = {
    date: '2026-10-02',
    created_at: '2026-10-02T12:00:00.000Z',
    id: '00000000-0000-4000-8000-000000000001',
  };

  beforeEach(() => db.query.mockReset().mockResolvedValue({ rows: [] }));

  it('applies the stable cursor before month filters for personal lists', async () => {
    await Expense.findByUser('user-1', { limit: 26, month: '2026-10', cursor });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('(e.date, e.created_at, e.id) < ($4::date, $5::timestamptz, $6::uuid)');
    expect(sql).toContain('ORDER BY e.date DESC, e.created_at DESC, e.id DESC');
    expect(params.slice(0, 6)).toEqual(['user-1', 26, 0, cursor.date, cursor.created_at, cursor.id]);
  });

  it('keeps household privacy parameters after the cursor tuple', async () => {
    await Expense.findByHousehold('household-1', {
      userId: 'user-1',
      limit: 26,
      month: '2026-10',
      cursor,
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('(e.is_private = FALSE OR e.user_id = $7)');
    expect(params.slice(0, 7)).toEqual(['household-1', 26, 0, cursor.date, cursor.created_at, cursor.id, 'user-1']);
  });
});
