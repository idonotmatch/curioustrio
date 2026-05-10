const {
  monthFromDate,
  sourceEventFromInput,
} = require('../../src/services/projectionRefreshService');

describe('projectionRefreshService', () => {
  it('normalizes refresh source events from expense mutations', () => {
    const event = sourceEventFromInput({
      reason: 'expense_updated',
      scope: 'household',
      period: '2026-05',
      expense: {
        id: '3f6e3ae2-3cb6-4a35-aaf3-fc5f47028e34',
        category_id: 'db3151a2-77c4-4c83-bb61-86bc074dd14c',
        merchant: 'Trader Joes',
      },
      metadata: { source: 'expense_edit' },
    });

    expect(event).toEqual({
      reason: 'expense_updated',
      scope: 'household',
      period: '2026-05',
      expense_id: '3f6e3ae2-3cb6-4a35-aaf3-fc5f47028e34',
      category_id: 'db3151a2-77c4-4c83-bb61-86bc074dd14c',
      merchant: 'Trader Joes',
      source: 'expense_edit',
    });
  });

  it('derives a projection period from expense dates', () => {
    expect(monthFromDate('2026-05-07')).toBe('2026-05');
    expect(monthFromDate(new Date('2026-06-15T12:00:00Z'))).toBe('2026-06');
    expect(monthFromDate(null)).toBeNull();
  });
});
