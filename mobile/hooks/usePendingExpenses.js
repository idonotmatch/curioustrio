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

function appendPendingExpenses(nextExpenses) {
  const byId = new Map(sharedPendingExpenses.map((expense) => [expense?.id, expense]));
  for (const expense of Array.isArray(nextExpenses) ? nextExpenses : []) {
    if (expense?.id) byId.set(expense.id, expense);
  }
  publishPendingExpenses([...byId.values()]);
}

function sanitizePendingPage(page = {}) {
  const sourceItems = Array.isArray(page) ? page : page?.items || [];
  const sourceById = new Map(sourceItems.map((expense) => [expense?.id, expense]));
  const items = sanitizeExpenseCollection(sourceItems).map((expense) => {
    const hint = sourceById.get(expense.id)?.gmail_review_hint;
    if (!hint || typeof hint !== 'object') return expense;
    return {
      ...expense,
      gmail_review_hint: {
        review_mode: hint.review_mode || null,
        likely_changed_fields: Array.isArray(hint.likely_changed_fields)
          ? hint.likely_changed_fields.slice(0, 8)
          : [],
      },
    };
  });
  return {
    items,
    next_cursor: Array.isArray(page) ? null : page?.next_cursor || null,
  };
}

export function removePendingExpense(id) {
  if (!id) return;
  optimisticallyRemovedPendingIds.set(id, Date.now() + OPTIMISTIC_REMOVE_TTL_MS);
  publishPendingExpenses(sharedPendingExpenses.filter((expense) => expense.id !== id));
}

export function resetPendingExpenseStore() {
  optimisticallyRemovedPendingIds.clear();
  publishPendingExpenses([]);
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
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
      () => api.get('/expenses/pending?paginated=1&limit=25'),
      (page) => {
        const data = Array.isArray(page) ? page : page?.items || [];
        publishPendingExpenses(data);
        setNextCursor(Array.isArray(page) ? null : page?.next_cursor || null);
        setLoading(false);
        saveExpenseSnapshots(data);
      },
      (err) => { setError(err.message); setLoading(false); },
      { serialize: sanitizePendingPage, forceRefresh: options?.forceRefresh === true },
    );
  }, [isUsingMockData]);

  const loadMore = useCallback(async () => {
    if (isUsingMockData || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get(`/expenses/pending?paginated=1&limit=25&cursor=${encodeURIComponent(nextCursor)}`);
      const items = sanitizePendingPage(page).items;
      appendPendingExpenses(items);
      saveExpenseSnapshots(items);
      setNextCursor(page?.next_cursor || null);
    } catch (err) {
      setError(err?.message || 'Could not load more review items');
    } finally {
      setLoadingMore(false);
    }
  }, [isUsingMockData, loadingMore, nextCursor]);

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

  return { expenses, loading, loadingMore, hasMore: Boolean(nextCursor), error, refresh, loadMore, isUsingMockData, resolveMockExpense };
}
