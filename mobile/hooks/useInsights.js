import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useInsights(limit = 5) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    await loadWithCache(
      `cache:insights:${limit}`,
      () => api.get(`/insights?limit=${limit}`),
      (data) => { setInsights(data || []); setLoading(false); },
      () => { setInsights([]); setLoading(false); },
    );
  }, [limit]);

  useEffect(() => { refresh(); }, [refresh]);

  return { insights, loading, refresh };
}
