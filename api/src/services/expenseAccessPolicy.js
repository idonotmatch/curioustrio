function canViewExpense(user, expense) {
  if (!user || !expense) return false;
  if (expense.user_id === user.id) return true;
  const inSameHousehold = !!(user.household_id && expense.household_id === user.household_id);
  if (!inSameHousehold) return false;
  return expense.is_private !== true;
}

function canDeleteExpense(user, expense) {
  if (!user || !expense) return false;
  return expense.user_id === user.id;
}

function householdExpenseVisibilitySql(requesterParamPosition, { alias = 'e' } = {}) {
  if (!Number.isInteger(requesterParamPosition) || requesterParamPosition < 1) {
    throw new Error('requesterParamPosition must be a positive integer');
  }
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('alias must be a SQL identifier');
  }
  return `(COALESCE(${alias}.is_private, FALSE) = FALSE OR ${alias}.user_id = $${requesterParamPosition})`;
}

module.exports = {
  canDeleteExpense,
  canViewExpense,
  householdExpenseVisibilitySql,
};
