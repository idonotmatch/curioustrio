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

module.exports = {
  canDeleteExpense,
  canViewExpense,
};
