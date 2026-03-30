import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export function useHouseholdExpenses(month) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = month ? `/expenses/household?month=${month}` : '/expenses/household';
      const data = await api.get(url);
      setExpenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return { expenses, loading, error, refresh, total };
}
