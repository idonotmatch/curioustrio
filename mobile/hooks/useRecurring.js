import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

export function useRecurring() {
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (options = {}) => {
    return loadWithCache(
      'cache:recurring',
      () => api.get('/recurring'),
      (data) => { setRecurring(data || []); setLoading(false); },
      () => { setRecurring([]); setLoading(false); },
      { forceRefresh: options?.forceRefresh === true },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.recurring, refresh);

  return { recurring, loading, refresh };
}
