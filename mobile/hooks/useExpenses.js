import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadCacheOnly } from '../services/cache';

// Personal expenses — only the local user writes these.
// Cache is authoritative; network is only hit on first load or after invalidation.
// After any mutation, call invalidateCache(`cache:expenses:${month}`) before navigating away.
export function useExpenses(month) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    await loadCacheOnly(
      `cache:expenses:${month || 'all'}`,
      () => api.get(month ? `/expenses?month=${month}` : '/expenses'),
      (data) => { setExpenses(data); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh };
}
