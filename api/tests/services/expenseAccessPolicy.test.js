const {
  canDeleteExpense,
  canViewExpense,
  householdExpenseVisibilitySql,
} = require('../../src/services/expenseAccessPolicy');

describe('expenseAccessPolicy', () => {
  const owner = { id: 1, household_id: 10 };
  const householdMember = { id: 2, household_id: 10 };
  const outsider = { id: 3, household_id: 20 };

  it('lets owners view and delete their own expenses, including private ones', () => {
    const expense = { user_id: 1, household_id: 10, is_private: true };

    expect(canViewExpense(owner, expense)).toBe(true);
    expect(canDeleteExpense(owner, expense)).toBe(true);
  });

  it('lets household members view only shared expenses', () => {
    expect(canViewExpense(householdMember, {
      user_id: 1,
      household_id: 10,
      is_private: false,
    })).toBe(true);

    expect(canViewExpense(householdMember, {
      user_id: 1,
      household_id: 10,
      is_private: true,
    })).toBe(false);
  });

  it('blocks outsiders and prevents household members from deleting another user expense', () => {
    const sharedExpense = { user_id: 1, household_id: 10, is_private: false };

    expect(canViewExpense(outsider, sharedExpense)).toBe(false);
    expect(canDeleteExpense(householdMember, sharedExpense)).toBe(false);
  });

  it('builds the same owner-or-shared rule for aggregate queries', () => {
    expect(householdExpenseVisibilitySql(4)).toBe(
      '(COALESCE(e.is_private, FALSE) = FALSE OR e.user_id = $4)'
    );
    expect(householdExpenseVisibilitySql(2, { alias: 'expenses' })).toBe(
      '(COALESCE(expenses.is_private, FALSE) = FALSE OR expenses.user_id = $2)'
    );
  });
});
