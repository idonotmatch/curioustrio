import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useBudget() {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/budgets');
      setBudget(data);
    } catch {
      setBudget(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
