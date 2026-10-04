jest.mock('../../src/db', () => ({ query: jest.fn() }));

const db = require('../../src/db');
const { buildReceiptParsingContext } = require('../../src/services/receiptContextService');

describe('receiptContextService privacy', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('limits every expense-derived household prior to the requesting user visibility', async () => {
    await buildReceiptParsingContext({
      householdId: 'household-1',
      requesterUserId: 'user-1',
      merchantHint: 'Target',
    });

    expect(db.query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toContain('COALESCE(e.is_private, FALSE) = FALSE');
      expect(params).toContain('user-1');
    }
  });
});
