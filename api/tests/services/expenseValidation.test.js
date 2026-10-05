const {
  isValidDate,
  validateExpenseCoreFields,
} = require('../../src/services/expenseValidation');

describe('expense core validation', () => {
  const validExpense = {
    merchant: 'Corner Store',
    amount: 27.10,
    date: '2026-10-04',
    source: 'manual',
  };

  it('accepts valid expenses and negative refunds', () => {
    expect(validateExpenseCoreFields(validExpense)).toEqual({ error: null, reason: null });
    expect(validateExpenseCoreFields({ ...validExpense, amount: -12, source: 'refund' })).toEqual({ error: null, reason: null });
  });

  it.each([
    [{ ...validExpense, merchant: '   ' }, 'missing_merchant'],
    [{ ...validExpense, amount: 0 }, 'invalid_amount'],
    [{ ...validExpense, amount: 'not-money' }, 'invalid_amount'],
    [{ ...validExpense, date: '2026-02-30' }, 'invalid_date'],
    [{ ...validExpense, source: 'unknown' }, 'invalid_source'],
  ])('rejects invalid core values', (payload, reason) => {
    expect(validateExpenseCoreFields(payload)).toMatchObject({ reason });
  });

  it('only validates provided fields for patches', () => {
    expect(validateExpenseCoreFields({ notes: 'Updated' }, { partial: true })).toEqual({ error: null, reason: null });
    expect(validateExpenseCoreFields({ amount: null }, { partial: true })).toMatchObject({ reason: 'invalid_amount' });
  });

  it('rejects calendar rollovers', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
  });
});
