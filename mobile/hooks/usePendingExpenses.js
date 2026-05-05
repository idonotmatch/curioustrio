import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';
import { buildMockPendingExpenses } from '../fixtures/mockGmailImport';
const { sanitizeExpenseCollection } = require('../services/storageSanitizers');

const FORCE_MOCK_PENDING_PREVIEW = false;
let mockPendingExpensesState = buildMockPendingExpenses();
let sharedPendingExpenses = [];
const subscribers = new Set();

function publishPendingExpenses(nextExpenses) {
  sharedPendingExpenses = Array.isArray(nextExpenses) ? nextExpenses : [];
  subscribers.forEach((callback) => {
    try {
      callback(sharedPendingExpenses);
    } catch {
      // ignore subscriber failures
    }
  });
}

export function removePendingExpense(id) {
  if (!id) return;
  publishPendingExpenses(sharedPendingExpenses.filter((expense) => expense.id !== id));
}

export function usePendingExpenses() {
  const isUsingMockData = __DEV__ && FORCE_MOCK_PENDING_PREVIEW;
  const [expenses, setExpenses] = useState(() => (isUsingMockData ? mockPendingExpensesState : sharedPendingExpenses));
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
        publishPendingExpenses(data);
        setLoading(false);
        saveExpenseSnapshots(data);
      },
      (err) => { setError(err.message); setLoading(false); },
      { serialize: sanitizeExpenseCollection },
    );
  }, [isUsingMockData]);

  const resolveMockExpense = useCallback((id) => {
    if (!isUsingMockData) return false;
    mockPendingExpensesState = mockPendingExpensesState.filter((expense) => expense.id !== id);
    setExpenses([...mockPendingExpensesState]);
    return true;
  }, [isUsingMockData]);

  useEffect(() => {
    if (isUsingMockData) return undefined;
    const subscriber = (nextExpenses) => setExpenses([...nextExpenses]);
    subscribers.add(subscriber);
    setExpenses([...sharedPendingExpenses]);
    return () => {
      subscribers.delete(subscriber);
    };
  }, [isUsingMockData]);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense };
}
