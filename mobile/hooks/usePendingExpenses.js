import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';
import { buildMockPendingExpenses } from '../fixtures/mockGmailImport';

const FORCE_MOCK_PENDING_PREVIEW = true;
let mockPendingExpensesState = buildMockPendingExpenses();

export function usePendingExpenses() {
  const isUsingMockData = __DEV__ && FORCE_MOCK_PENDING_PREVIEW;
  const [expenses, setExpenses] = useState(() => (isUsingMockData ? mockPendingExpensesState : []));
  const [loading, setLoading] = useState(!isUsingMockData);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (isUsingMockData) {
      setExpenses([...mockPendingExpensesState]);
      setLoading(false);
      setError(null);
      return;
    }
    setError(null);
    await loadWithCache(
      'cache:expenses:pending',
      () => api.get('/expenses/pending'),
      (data) => {
        setExpenses(data);
        setLoading(false);
        saveExpenseSnapshots(data);
      },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [isUsingMockData]);

  const resolveMockExpense = useCallback((id) => {
    if (!isUsingMockData) return false;
    mockPendingExpensesState = mockPendingExpensesState.filter((expense) => expense.id !== id);
    setExpenses([...mockPendingExpensesState]);
    return true;
  }, [isUsingMockData]);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense };
}
