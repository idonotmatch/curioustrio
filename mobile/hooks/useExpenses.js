import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';
const { sanitizeExpenseCollection } = require('../services/storageSanitizers');

// Personal expenses can be mutated from multiple devices for the same account.
// Serve cache immediately, but always revalidate so "Mine" stays in sync across
// phone + simulator without waiting for a local cache invalidation.
export function useExpenses(month, startDayOverride) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async (options = {}) => {
    const requestVersion = ++requestVersionRef.current;
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const pageParams = [params, 'paginated=1', 'limit=25'].filter(Boolean).join('&');
    const url = `/expenses?${pageParams}`;
    return loadWithCache(
      `cache:expenses:v2:${month || 'all'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => {
        if (requestVersion !== requestVersionRef.current) return;
        const items = sanitizeExpenseCollection(data?.items || []);
        setExpenses(items);
        setNextCursor(data?.next_cursor || null);
        setLoading(false);
        saveExpenseSnapshots(items);
      },
      (err) => {
        if (requestVersion !== requestVersionRef.current) return;
        setError(err.message);
        setLoading(false);
      },
      { forceRefresh: options?.forceRefresh === true },
    );
  }, [month, startDayOverride]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const requestVersion = requestVersionRef.current;
    setLoadingMore(true);
    try {
      const params = [
        month && `month=${month}`,
        startDayOverride && `start_day=${startDayOverride}`,
        'paginated=1',
        'limit=25',
        `cursor=${encodeURIComponent(nextCursor)}`,
      ].filter(Boolean).join('&');
      const data = await api.get(`/expenses?${params}`);
      if (requestVersion !== requestVersionRef.current) return;
      const items = sanitizeExpenseCollection(data?.items || []);
      setExpenses((current) => {
        const seen = new Set(current.map((expense) => expense.id));
        return [...current, ...items.filter((expense) => !seen.has(expense.id))];
      });
      setNextCursor(data?.next_cursor || null);
      saveExpenseSnapshots(items);
    } catch (err) {
      if (requestVersion === requestVersionRef.current) {
        setError(err?.message || 'Could not load more transactions');
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, month, nextCursor, startDayOverride]);

  useEffect(() => {
    refresh();
    return () => { requestVersionRef.current += 1; };
  }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.expenses, refresh);

  return { expenses, loading, loadingMore, hasMore: !!nextCursor, error, refresh, loadMore };
}
