import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { invalidateCacheByPrefix, loadWithCache } from '../services/cache';

export function useInsights(limit = 5) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const cacheKey = `cache:insights:${limit}`;

  const refresh = useCallback(async () => {
    await loadWithCache(
      cacheKey,
      () => api.get(`/insights?limit=${limit}`),
      (data) => { setInsights(data || []); setLoading(false); },
      () => { setInsights([]); setLoading(false); },
    );
  }, [cacheKey, limit]);

  const markSeen = useCallback(async (ids = []) => {
    const cleanIds = ids.filter(Boolean);
    if (!cleanIds.length) return;
    try {
      await api.post('/insights/seen', { ids: cleanIds });
      await invalidateCacheByPrefix('cache:insights:');
      setInsights((current) => current.map((insight) => (
        cleanIds.includes(insight.id)
          ? { ...insight, state: { status: 'seen', updated_at: new Date().toISOString() } }
          : insight
      )));
    } catch {}
  }, [cacheKey]);

  const dismiss = useCallback(async (id) => {
    if (!id) return;
    await api.post(`/insights/${encodeURIComponent(id)}/dismiss`, {});
    await invalidateCacheByPrefix('cache:insights:');
    setInsights((current) => current.filter((insight) => insight.id !== id));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { insights, loading, refresh, markSeen, dismiss };
}
