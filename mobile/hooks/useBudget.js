import { useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

export function useBudget(month) {
  const [budget, setBudget] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = month ? `/budgets?month=${month}` : '/budgets';
      const data = await api.get(url);
      setBudget(data);
    } catch {
      setBudget(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { budget, loading, refresh };
}
