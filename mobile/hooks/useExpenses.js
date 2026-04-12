import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';

// Throttle background revalidation for the current month during an active session.
// Pull-to-refresh always bypasses this by calling refresh() directly.
const REVALIDATE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Past months are frozen — no need to ever background-fetch them.
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

  function buildArgs() {
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses?${params}` : '/expenses';
    const key = `cache:expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    const fetcher = () => api.get(url);
    const onData = (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); };
    const onError = (err) => { setError(err.message); setLoading(false); };
    return { key, fetcher, onData, onError };
  }

  // Internal load (used on mount / dep change).
  // Past months: cache-first — no network call if already cached.
  // Current month: stale-while-revalidate with TTL throttle.
  const load = useCallback(async () => {
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();
    if (isPastMonth(month)) {
      await loadCacheOnly(key, fetcher, onData, onError);
    } else {
      await loadWithCache(key, fetcher, onData, onError, { ttlMs: REVALIDATE_TTL_MS });
    }
  }, [month, startDayOverride]);

  // Explicit refresh (pull-to-refresh, post-mutation) — always revalidates, no TTL.
  const refresh = useCallback(async () => {
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();
    if (isPastMonth(month)) {
      await loadCacheOnly(key, fetcher, onData, onError);
    } else {
      await loadWithCache(key, fetcher, onData, onError);
    }
  }, [month, startDayOverride]);

  useEffect(() => { load(); }, [load]);

  // softRefresh: TTL-respecting refresh for lifecycle events (tab focus, app foreground).
  // Unlike refresh(), this won't re-fetch if data was recently loaded or mutated.
  return { expenses, loading, error, refresh, softRefresh: load };
}
