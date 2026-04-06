import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots } from '../services/expenseLocalStore';

export function usePendingExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    await loadWithCache(
      'cache:expenses:pending',
      () => api.get('/expenses/pending'),
      (data) => {
        setExpenses(data);
        setLoading(false);
        saveExpenseSnapshots(data);
      },
      (err) => { setError(err.message); setLoading(false); },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { expenses, loading, error, refresh };
}
