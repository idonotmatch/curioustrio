import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { FRESHNESS_DOMAINS } from '../services/freshnessRegistry';
import { useFreshnessRefresh } from './useFreshnessRefresh';

const SUMMARY_DOMAINS = [
  FRESHNESS_DOMAINS.expenses,
  FRESHNESS_DOMAINS.householdExpenses,
  FRESHNESS_DOMAINS.budget,
  FRESHNESS_DOMAINS.household,
  FRESHNESS_DOMAINS.watchedPlans,
];

export function useSummaryBundle(period, startDay) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async (options = {}) => {
    const requestVersion = ++requestVersionRef.current;
    setError(null);
    const query = [
      `period=${encodeURIComponent(period)}`,
      startDay ? `start_day=${encodeURIComponent(startDay)}` : null,
    ].filter(Boolean).join('&');
    return loadWithCache(
      `cache:summary-bundle:v2:${period}:${startDay || 'default'}`,
      () => api.get(`/summary?${query}`),
      (data) => {
        if (requestVersion !== requestVersionRef.current) return;
        setSummary(data || null);
        setLoading(false);
      },
      (err) => {
        if (requestVersion !== requestVersionRef.current) return;
        setError(err?.message || 'Could not refresh summary');
        setLoading(false);
      },
      { forceRefresh: options?.forceRefresh === true },
    );
  }, [period, startDay]);

  useEffect(() => {
    refresh();
    return () => { requestVersionRef.current += 1; };
  }, [refresh]);
  useFreshnessRefresh(SUMMARY_DOMAINS, refresh, { delayMs: 700 });

  return { summary, loading, error, refresh };
}
