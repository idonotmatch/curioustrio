import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    await loadWithCache(
      'cache:categories',
      async () => {
        const data = await api.get('/categories');
        return data.categories || [];
      },
      (data) => { setCategories(data); setLoading(false); },
      () => setLoading(false),
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { categories, loading, refresh };
}
