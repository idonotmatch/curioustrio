import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';

const REVALIDATE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function isPastMonth(month) {
  if (!month) return false;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return month < current;
}

export function useHouseholdExpenses(month, startDayOverride, { enabled = true } = {}) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  function buildArgs() {
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses/household?${params}` : '/expenses/household';
    const key = `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    const fetcher = () => api.get(url);
    const onData = (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); };
    const onError = (err) => { setError(err.message); setLoading(false); };
    return { key, fetcher, onData, onError };
  }

  // Internal load — cache-first for past months, TTL-throttled SWR for current month.
  const load = useCallback(async () => {
    if (!enabled) {
      setExpenses([]);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();
    if (isPastMonth(month)) {
      await loadCacheOnly(key, fetcher, onData, onError);
    } else {
      await loadWithCache(key, fetcher, onData, onError, { ttlMs: REVALIDATE_TTL_MS });
    }
  }, [enabled, month, startDayOverride]);

  // Explicit refresh — always revalidates, no TTL.
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();
    if (isPastMonth(month)) {
      await loadCacheOnly(key, fetcher, onData, onError);
    } else {
      await loadWithCache(key, fetcher, onData, onError);
    }
  }, [enabled, month, startDayOverride]);

  useEffect(() => { load(); }, [load]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
