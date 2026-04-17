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

export function useExpenses(month, startDayOverride) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // TTL-respecting — safe for focus events, skips network if cache is fresh
  const load = useCallback(async () => {
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses?${params}` : '/expenses';
    const key = `cache:expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    const onData = (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); };
    const onError = (err) => { setError(err.message); setLoading(false); };
    if (isPastMonth(month)) {
      await loadCacheOnly(key, () => api.get(url), onData, onError);
    } else {
      await loadWithCache(key, () => api.get(url), onData, onError, { ttlMs: REVALIDATE_TTL_MS });
    }
  }, [month, startDayOverride]);

  // Force revalidation regardless of TTL — for pull-to-refresh
  const refresh = useCallback(async () => {
    setError(null);
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses?${params}` : '/expenses';
    const key = `cache:expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    await loadWithCache(
      key,
      () => api.get(url),
      (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [month, startDayOverride]);

  useEffect(() => { load(); }, [load]);

  return { expenses, loading, error, refresh, softRefresh: load };
}
