import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { invalidateCacheByPrefix, loadFreshWithCacheFallback } from '../services/cache';

export function useInsights(limit = 5) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cacheKey = `cache:insights:v2:${limit}`;

  const refresh = useCallback(async () => {
    setError(null);
    await loadFreshWithCacheFallback(
      cacheKey,
      () => api.get(`/insights?limit=${limit}`),
      (data) => { setInsights(data || []); setLoading(false); setError(null); },
      (err) => { setInsights([]); setLoading(false); setError(err?.message || 'Could not load insights'); },
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

  const dismiss = useCallback(async (id, metadata = null) => {
    if (!id) return;
    setInsights((current) => current.filter((insight) => insight.id !== id));
    await api.post(`/insights/${encodeURIComponent(id)}/dismiss`, metadata ? { metadata } : {});
    await invalidateCacheByPrefix('cache:insights:');
    await refresh();
  }, [refresh]);

  const logEvents = useCallback(async (events = []) => {
    const clean = events
      .map((event) => ({
        insight_id: `${event?.insight_id || ''}`.trim(),
        event_type: `${event?.event_type || ''}`.trim(),
        metadata: event?.metadata ?? undefined,
      }))
      .filter((event) => event.insight_id && event.event_type);

    if (!clean.length) return;
    try {
      await api.post('/insights/events', { events: clean });
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { insights, loading, error, refresh, markSeen, dismiss, logEvents };
}
