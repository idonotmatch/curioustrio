import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';

// cacheOnly: true for personal scope (only local user mutates it).
//            false (default) for household scope (other members can change it).
export function useBudget(month, scope, { cacheOnly = false, startDayOverride = null, enabled = true } = {}) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
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
    await loader(
      `cache:budget:${month || 'all'}:${scope || 'default'}:${startDayOverride || 'default'}`,
      () => api.get(url),
      (data) => { setBudget(data); setLoading(false); },
      (err) => { setBudget(null); setError(err?.message || 'Could not load budget'); setLoading(false); },
    );
  }, [month, scope, cacheOnly, startDayOverride, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, error, refresh };
}
