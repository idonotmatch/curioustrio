import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

export function usePendingExpenseCount() {
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (options = {}) => {
    await loadWithCache(
      'cache:expenses:pending-count',
      () => api.get('/expenses/pending/count'),
      (data) => {
        setCount(Math.max(0, Number(data?.count || 0)));
        setError(null);
      },
      (err) => setError(err?.message || 'Could not refresh pending count'),
      { forceRefresh: options?.forceRefresh === true, maxAgeMs: 15000 },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useFreshnessRefresh(FRESHNESS_DOMAINS.pendingExpenses, refresh, { delayMs: 700 });

  return { count, error, refresh };
}
