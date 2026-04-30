import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { invalidateCacheByPrefix, loadWithCache } from '../services/cache';

function buildInsightSuppressionKey(insight = {}) {
  const metadata = insight?.metadata || {};
  const continuityKey = `${metadata?.continuity_key || ''}`.trim();
  if (continuityKey) return `continuity:${continuityKey}`;

  const type = `${insight?.type || metadata?.type || metadata?.insight_type || ''}`.trim();
  const scope = `${metadata?.scope || ''}`.trim();
  const entityType = `${insight?.entity_type || metadata?.entity_type || ''}`.trim();
  const entityId = `${insight?.entity_id || metadata?.entity_id || ''}`.trim();
  const categoryKey = `${metadata?.category_key || ''}`.trim();
  const merchantKey = `${metadata?.merchant_key || ''}`.trim();
  const month = `${metadata?.month || ''}`.trim();

  const parts = [type, scope, entityType, entityId, categoryKey, merchantKey, month].filter(Boolean);
  return parts.length ? `story:${parts.join(':')}` : '';
}

function filterSuppressedInsights(insights = [], suppressedMap = new Map()) {
  if (!Array.isArray(insights) || suppressedMap.size === 0) return Array.isArray(insights) ? insights : [];
  const now = Date.now();
  return insights.filter((insight) => {
    const insightId = `${insight?.id || ''}`.trim();
    const storyKey = buildInsightSuppressionKey(insight);
    const idSuppressedUntil = insightId ? suppressedMap.get(`id:${insightId}`) : null;
    const storySuppressedUntil = storyKey ? suppressedMap.get(storyKey) : null;
    if (idSuppressedUntil && idSuppressedUntil > now) return false;
    if (storySuppressedUntil && storySuppressedUntil > now) return false;
    return true;
  });
}

export function useInsights(limit = 5, options = {}) {
  const fetchLimit = Math.max(limit, Number(options?.fetchLimit) || limit);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dismissedSuppressions, setDismissedSuppressions] = useState(() => new Map());
  const cacheKey = `cache:insights:v2:${limit}:${fetchLimit}`;

  const refresh = useCallback(async () => {
    setError(null);
    await loadWithCache(
      cacheKey,
      () => api.get(`/insights?limit=${fetchLimit}`),
      (data) => {
        const filtered = filterSuppressedInsights(data || [], dismissedSuppressions);
        setInsights(filtered.slice(0, limit));
        setLoading(false);
        setError(null);
      },
      (err) => { setInsights([]); setLoading(false); setError(err?.message || 'Could not load insights'); },
    );
  }, [cacheKey, fetchLimit, limit, dismissedSuppressions]);

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
    const suppressUntil = Date.now() + (6 * 60 * 60 * 1000);
    const storyKey = buildInsightSuppressionKey({
      id,
      type: metadata?.type || metadata?.insight_type || null,
      entity_type: metadata?.entity_type || null,
      entity_id: metadata?.entity_id || null,
      metadata: metadata || {},
    });
    setDismissedSuppressions((current) => {
      const next = new Map(current);
      next.set(`id:${id}`, suppressUntil);
      if (storyKey) next.set(storyKey, suppressUntil);
      return next;
    });
    setInsights((current) => current.filter((insight) => {
      if (`${insight?.id || ''}` === `${id}`) return false;
      const currentStoryKey = buildInsightSuppressionKey(insight);
      return !(storyKey && currentStoryKey === storyKey);
    }));
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
