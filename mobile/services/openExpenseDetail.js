import { saveExpenseSnapshot } from './expenseLocalStore';

function sanitizeExpenseForRoute(expense = {}) {
  const expenseId = expense?.id || expense?.expense_id || null;
  if (!expenseId) return null;
  return {
    id: expenseId,
    merchant: expense.merchant || expense.description || null,
    description: expense.description || null,
    amount: expense.amount ?? expense.item_amount ?? null,
    date: expense.date || null,
    category_name: expense.category_name || null,
    user_name: expense.user_name || null,
    status: expense.status || null,
    source: expense.source || null,
    review_source: expense.review_source || null,
    notes: expense.notes || null,
  };
}

export function openExpenseDetail(router, expense) {
  const payload = sanitizeExpenseForRoute(expense);
  if (!router || !payload?.id) return false;

  saveExpenseSnapshot(payload).catch(() => {});
  router.push({
    pathname: '/expense/[id]',
    params: {
      id: payload.id,
      expense: JSON.stringify(payload),
    },
  });
  return true;
}
