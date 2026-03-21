import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useHouseholdExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/expenses/household');
      setExpenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const total = expenses
    .filter(e => e.date?.startsWith(currentMonth))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
