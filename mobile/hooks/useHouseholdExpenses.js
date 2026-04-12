import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { saveExpenseSnapshots, loadExpenseSnapshotsForMonth } from '../services/expenseLocalStore';

const REVALIDATE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function isPastMonth(month) {
  if (!month) return false;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return month < current;
}

export function useHouseholdExpenses(month, startDayOverride, { enabled = true } = {}) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);

  function buildArgs() {
    const params = [
      month && `month=${month}`,
      startDayOverride && `start_day=${startDayOverride}`,
    ].filter(Boolean).join('&');
    const url = params ? `/expenses/household?${params}` : '/expenses/household';
    const key = `cache:household-expenses:${month || 'all'}:${startDayOverride || 'default'}`;
    const fetcher = () => api.get(url);
    const onData = (data) => { setExpenses(data); setLoading(false); saveExpenseSnapshots(data); };
    const onError = (err) => { setError(err.message); setLoading(false); };
    return { key, fetcher, onData, onError };
  }

  // Internal load — cache-first for past months with snapshot hydration fallback,
  // TTL-throttled SWR for current month.
  const load = useCallback(async () => {
    if (!enabled) {
      setExpenses([]);
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();

    if (isPastMonth(month)) {
      // 1. Try month-array cache (fastest path)
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const { data } = JSON.parse(raw);
          if (Array.isArray(data)) { onData(data); return; }
        }
      } catch {}

      // 2. Cache miss — reconstruct from individual snapshots so past months
      //    render offline without a network call.
      const snapshots = await loadExpenseSnapshotsForMonth(month);
      if (snapshots) {
        onData(snapshots);
        // Seed the month-array cache (ts=0 so a forced refresh will still reconcile)
        AsyncStorage.setItem(key, JSON.stringify({ data: snapshots, ts: 0 })).catch(() => {});
        return;
      }

      // 3. No snapshots either — fall back to network
      try {
        const fresh = await fetcher();
        onData(fresh);
        AsyncStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })).catch(() => {});
      } catch (err) {
        onError(err);
      }
      return;
    }

    // Current month: TTL-throttled stale-while-revalidate
    await loadWithCache(key, fetcher, onData, onError, { ttlMs: REVALIDATE_TTL_MS });
  }, [enabled, month, startDayOverride]);

  // Explicit refresh (pull-to-refresh, post-mutation) — always revalidates, no TTL.
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    const { key, fetcher, onData, onError } = buildArgs();
    if (isPastMonth(month)) {
      // For past months, explicit refresh is allowed (user asked for it)
      try {
        const fresh = await fetcher();
        onData(fresh);
        AsyncStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })).catch(() => {});
      } catch (err) {
        onError(err);
      }
      return;
    }
    await loadWithCache(key, fetcher, onData, onError);
  }, [enabled, month, startDayOverride]);

  useEffect(() => { load(); }, [load]);

  // Server already filtered by month — sum all returned expenses
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  // softRefresh: TTL-respecting refresh for lifecycle events (tab focus, app foreground).
  // Unlike refresh(), this won't hammer the server if data was recently fetched.
  return { expenses, loading, error, refresh, softRefresh: load, total };
}
