import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';
const { sanitizeExpenseCollection } = require('../services/storageSanitizers');

export function useHouseholdExpenses(month, startDayOverride, { enabled = true } = {}) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = useCallback(async (options = {}) => {
    if (!enabled) {
      setExpenses([]);
      setError(null);
      setLoading(false);
      setNextCursor(null);
      return;
    }
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const pageParams = [params, 'paginated=1', 'limit=25'].filter(Boolean).join('&');
    const url = `/expenses/household?${pageParams}`;
    await loadWithCache(
      `cache:household-expenses:v2:${month || 'all'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => {
        const items = sanitizeExpenseCollection(data?.items || []);
        setExpenses(items);
        setNextCursor(data?.next_cursor || null);
        setLoading(false);
        saveExpenseSnapshots(items);
      },
      (err) => { setError(err.message); setLoading(false); },
      { forceRefresh: options?.forceRefresh === true },
    );
  }, [enabled, month, startDayOverride]);

  const loadMore = useCallback(async () => {
    if (!enabled || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = [
        month && `month=${month}`,
        startDayOverride && `start_day=${startDayOverride}`,
        'paginated=1',
        'limit=25',
        `cursor=${encodeURIComponent(nextCursor)}`,
      ].filter(Boolean).join('&');
      const data = await api.get(`/expenses/household?${params}`);
      const items = sanitizeExpenseCollection(data?.items || []);
      setExpenses((current) => {
        const seen = new Set(current.map((expense) => expense.id));
        return [...current, ...items.filter((expense) => !seen.has(expense.id))];
      });
      setNextCursor(data?.next_cursor || null);
      saveExpenseSnapshots(items);
    } catch (err) {
      setError(err?.message || 'Could not load more transactions');
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, loadingMore, month, nextCursor, startDayOverride]);

  useEffect(() => { refresh(); }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.householdExpenses, refresh);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, loadingMore, hasMore: !!nextCursor, error, refresh, loadMore, total };
}
