import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';
import { buildMockPendingExpenses } from '../fixtures/mockGmailImport';
const { sanitizeExpenseCollection } = require('../services/storageSanitizers');

const FORCE_MOCK_PENDING_PREVIEW = false;
const OPTIMISTIC_REMOVE_TTL_MS = 2 * 60 * 1000;
let mockPendingExpensesState = buildMockPendingExpenses();
let sharedPendingExpenses = [];
const optimisticallyRemovedPendingIds = new Map();
const subscribers = new Set();

function pruneOptimisticRemovals(now = Date.now()) {
  for (const [id, expiresAt] of optimisticallyRemovedPendingIds.entries()) {
    if (expiresAt <= now) optimisticallyRemovedPendingIds.delete(id);
  }
}

function filterOptimisticallyRemoved(expenses = []) {
  pruneOptimisticRemovals();
  if (!optimisticallyRemovedPendingIds.size) return expenses;
  return expenses.filter((expense) => !optimisticallyRemovedPendingIds.has(expense?.id));
}

function publishPendingExpenses(nextExpenses) {
  sharedPendingExpenses = filterOptimisticallyRemoved(Array.isArray(nextExpenses) ? nextExpenses : []);
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
  optimisticallyRemovedPendingIds.set(id, Date.now() + OPTIMISTIC_REMOVE_TTL_MS);
  publishPendingExpenses(sharedPendingExpenses.filter((expense) => expense.id !== id));
}

export function restorePendingExpense(expense) {
  if (!expense?.id) return;
  optimisticallyRemovedPendingIds.delete(expense.id);
  const exists = sharedPendingExpenses.some((item) => item?.id === expense.id);
  if (exists) return;
  publishPendingExpenses([expense, ...sharedPendingExpenses]);
}

export function usePendingExpenses() {
  const isUsingMockData = __DEV__ && FORCE_MOCK_PENDING_PREVIEW;
  const [expenses, setExpenses] = useState(() => (isUsingMockData ? mockPendingExpensesState : sharedPendingExpenses));
  const [loading, setLoading] = useState(!isUsingMockData);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (options = {}) => {
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
      { serialize: sanitizeExpenseCollection, forceRefresh: options?.forceRefresh === true },
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
  useFreshnessRefresh(FRESHNESS_DOMAINS.pendingExpenses, refresh);

  return { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense };
}
