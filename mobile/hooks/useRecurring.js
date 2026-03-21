import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useRecurring() {
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/recurring');
      setRecurring(data);
    } catch {
      setRecurring([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { recurring, loading, refresh };
}
