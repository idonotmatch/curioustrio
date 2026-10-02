import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (options = {}) => {
    await loadWithCache(
      'cache:categories',
      async () => {
        const data = await api.get('/categories');
        return data.categories || [];
      },
      (data) => { setCategories(data); setLoading(false); },
      () => setLoading(false),
      { forceRefresh: options?.forceRefresh === true },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.categories, refresh);

  return { categories, loading, refresh };
}
