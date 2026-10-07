import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

// cacheOnly: true for personal scope (only local user mutates it).
//            false (default) for household scope (other members can change it).
export function useBudget(month, scope, { cacheOnly = false, startDayOverride = null, enabled = true } = {}) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async (options = {}) => {
    const requestVersion = ++requestVersionRef.current;
    if (!enabled) {
      setBudget(null);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    const params = [
      month && `month=${month}`,
      scope && `scope=${scope}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/budgets?${params}` : '/budgets';
    const loader = cacheOnly ? loadCacheOnly : loadWithCache;
    const result = await loader(
      `cache:budget:${month || 'all'}:${scope || 'default'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => {
        if (requestVersion !== requestVersionRef.current) return;
        setBudget(data);
        setLoading(false);
      },
      (err) => {
        if (requestVersion !== requestVersionRef.current) return;
        setBudget(null);
        setError(err?.message || 'Could not load budget');
        setLoading(false);
      },
      { forceRefresh: options?.forceRefresh === true },
    );
    if (requestVersion === requestVersionRef.current && !result?.refreshSucceeded && result?.source === 'cache') {
      setError('Could not refresh the latest budget totals.');
    }
    return result;
  }, [month, scope, cacheOnly, startDayOverride, enabled]);

  useEffect(() => {
    refresh();
    return () => { requestVersionRef.current += 1; };
  }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.budget, refresh);

  return { budget, loading, error, refresh };
}
