import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

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
