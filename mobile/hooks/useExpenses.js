import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

// Personal expenses can be mutated from multiple devices for the same account.
// Serve cache immediately, but always revalidate so "Mine" stays in sync across
// phone + simulator without waiting for a local cache invalidation.
export function useExpenses(month) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    await loadWithCache(
      `cache:expenses:${month || 'all'}`,
      () => api.get(month ? `/expenses?month=${month}` : '/expenses'),
      (data) => { setExpenses(data); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh };
}
