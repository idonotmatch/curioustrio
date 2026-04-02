import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useRecurring() {
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    await loadWithCache(
      'cache:recurring',
      () => api.get('/recurring'),
      (data) => { setRecurring(data || []); setLoading(false); },
      () => { setRecurring([]); setLoading(false); },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { recurring, loading, refresh };
}
