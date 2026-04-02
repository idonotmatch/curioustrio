import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useBudget(month, scope) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const params = [
      month && `month=${month}`,
      scope && `scope=${scope}`,
    ].filter(Boolean).join('&');
    const url = params ? `/budgets?${params}` : '/budgets';
    await loadWithCache(
      `cache:budget:${month || 'all'}:${scope || 'default'}`,
      () => api.get(url),
      (data) => { setBudget(data); setLoading(false); },
      () => { setBudget(null); setLoading(false); },
    );
  }, [month, scope]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
