import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';

// cacheOnly: true for personal scope (only local user mutates it).
//            false (default) for household scope (other members can change it).
export function useBudget(month, scope, { cacheOnly = false, startDayOverride = null } = {}) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
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
      () => { setBudget(null); setLoading(false); },
    );
  }, [month, scope, cacheOnly, startDayOverride]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
