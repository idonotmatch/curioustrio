import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../services/api';
import { loadWithCache, loadCacheOnly } from '../services/cache';
import { getPrimaryActionForInsight } from '../services/insightPresentation';

const FEEDBACK_REASONS = [
  { key: 'wrong_timing', label: 'Wrong timing' },
  { key: 'not_relevant', label: 'Not relevant' },
  { key: 'not_accurate', label: 'Not accurate' },
  { key: 'already_knew', label: 'I already knew this' },
];

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const sign = Number(value) > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(1)}%`;
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${value}`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function titleForInsightType(type, fallbackTitle) {
  if (fallbackTitle) return fallbackTitle;
  switch (type) {
    case 'spend_pace_ahead':
    case 'spend_pace_behind':
      return 'Spending pace';
    case 'budget_too_low':
    case 'budget_too_high':
      return 'Budget fit';
    case 'top_category_driver':
      return 'Category driver';
    case 'one_offs_driving_variance':
      return 'One-off variance';
    case 'recurring_cost_pressure':
      return 'Recurring cost pressure';
    case 'projected_month_end_over_budget':
    case 'projected_month_end_under_budget':
    case 'one_off_expense_skewing_projection':
      return 'Month-end projection';
    case 'projected_category_surge':
    case 'projected_category_under_baseline':
      return 'Category projection';
    default:
      return 'Trend detail';
  }
}

function subjectLabel(scope) {
  return `${scope}` === 'household' ? 'Your household' : 'You';
}

function sharedContextCopy(scope) {
  return `${scope}` === 'household'
    ? 'This view is using shared household spending, budget room, and recurring pressure across everyone in the household.'
    : 'This view is using only your personal spending and budget context.';
}

function buildMockTrend(scope, month) {
  const household = `${scope}` === 'household';
  const periodLabel = month || '2026-04';

  return {
    period: {
      month: periodLabel,
      data_start_date: '2025-11-01',
    },
    pace: {
      current_spend_to_date: household ? 912.48 : 438.17,
      historical_spend_to_date_avg: household ? 736.22 : 364.91,
      delta_amount: household ? 176.26 : 73.26,
      delta_percent: household ? 23.9 : 20.1,
      projected_period_total: household ? 1528.9 : 742.15,
      historical_period_count: 5,
      top_drivers: [
        {
          category_key: 'groceries',
          category_name: 'Groceries',
          current_spend_to_date: household ? 402.88 : 214.56,
          historical_spend_to_date_avg: household ? 316.24 : 161.18,
          delta_amount: household ? 86.64 : 53.38,
          delta_percent: household ? 27.4 : 33.1,
        },
        {
          category_key: 'dining',
          category_name: 'Dining',
          current_spend_to_date: household ? 156.1 : 92.14,
          historical_spend_to_date_avg: household ? 181.74 : 106.42,
          delta_amount: household ? -25.64 : -14.28,
          delta_percent: household ? -14.1 : -13.4,
        },
      ],
      variance_breakdown: {
        one_off_delta_amount: 118.43,
        recurring_delta_amount: 41.27,
        top_one_off_merchants: [
          { merchant_key: 'costco', merchant_name: 'Costco', delta_amount: 96.52 },
          { merchant_key: 'mozelles', merchant_name: "Mozelle's", delta_amount: 21.91 },
        ],
      },
    },
    budget_adherence: {
      budget_limit: household ? 1350 : 620,
      projected_over_under: household ? 178.9 : 122.15,
      budget_fit: 'too_low',
      historical_period_count: 5,
    },
    projection: {
      overall: {
        current_spend_to_date: household ? 912.48 : 438.17,
        normal_spend_to_date: household ? 794.05 : 319.74,
        unusual_spend_to_date: 118.43,
        historical_expected_share_by_day: 0.57,
        baseline_projected_total: household ? 1392.18 : 560.95,
        adjusted_projected_total: household ? 1510.61 : 679.38,
        projection_excluding_unusuals: household ? 1392.18 : 560.95,
        projected_budget_delta: household ? 160.61 : 59.38,
        confidence: 'medium',
        historical_period_count: 5,
        top_unusual_expenses: [
          {
            id: 'mock-costco',
            merchant: 'Costco',
            amount: 96.52,
            category_name: 'Groceries',
            norm_reason: 'large_amount_outlier',
          },
          {
            id: 'mock-flowers',
            merchant: 'City Blossoms',
            amount: 21.91,
            category_name: 'Gifts',
            norm_reason: 'rare_merchant',
          },
        ],
      },
      categories: [
        {
          category_key: 'groceries',
          category_name: 'Groceries',
          current_spend_to_date: household ? 402.88 : 214.56,
          normal_spend_to_date: household ? 306.36 : 161.18,
          unusual_spend_to_date: household ? 96.52 : 53.38,
          historical_expected_share_by_day: 0.54,
          baseline_projected_total: household ? 567.33 : 298.48,
          adjusted_projected_total: household ? 663.85 : 351.86,
          projection_excluding_unusuals: household ? 567.33 : 298.48,
          confidence: 'medium',
          historical_period_count: 5,
          top_unusual_expenses: [
            {
              id: 'mock-costco',
              merchant: 'Costco',
              amount: 96.52,
              category_name: 'Groceries',
              norm_reason: 'large_amount_outlier',
            },
          ],
        },
        {
          category_key: 'dining',
          category_name: 'Dining',
          current_spend_to_date: household ? 156.1 : 92.14,
          normal_spend_to_date: household ? 156.1 : 92.14,
          unusual_spend_to_date: 0,
          historical_expected_share_by_day: 0.61,
          baseline_projected_total: household ? 255.9 : 151.05,
          adjusted_projected_total: household ? 255.9 : 151.05,
          projection_excluding_unusuals: household ? 255.9 : 151.05,
          confidence: 'medium',
          historical_period_count: 5,
          top_unusual_expenses: [],
        },
      ],
    },
  };
}

function buildMockCategoryExpenses(categoryKey) {
  if (`${categoryKey}` === 'dining') {
    return [
      { id: 'mock-dining-1', merchant: 'Sweetgreen', amount: 28.4, date: '2026-04-02', category_name: 'Dining', user_name: 'Dang' },
      { id: 'mock-dining-2', merchant: 'Joe Coffee', amount: 9.25, date: '2026-04-04', category_name: 'Dining', user_name: 'Dang' },
      { id: 'mock-dining-3', merchant: 'Sushi Nakazawa', amount: 74.8, date: '2026-04-05', category_name: 'Dining', user_name: 'Dang' },
    ];
  }
  return [
    { id: 'mock-groceries-1', merchant: 'Costco', amount: 96.52, date: '2026-04-02', category_name: 'Groceries', user_name: 'Dang' },
    { id: 'mock-groceries-2', merchant: 'Trader Joe\'s', amount: 48.13, date: '2026-04-03', category_name: 'Groceries', user_name: 'Dang' },
    { id: 'mock-groceries-3', merchant: 'Whole Foods', amount: 37.91, date: '2026-04-04', category_name: 'Groceries', user_name: 'Dang' },
    { id: 'mock-groceries-4', merchant: 'Costco', amount: 62.24, date: '2026-04-05', category_name: 'Groceries', user_name: 'Dang' },
  ];
}

function summaryCopy({ insightType, trend, categoryKey, scope }) {
  const pace = trend?.pace;
  const budget = trend?.budget_adherence;
  const projection = trend?.projection?.overall;
  const highlightedDriver = trend?.pace?.top_drivers?.find((driver) => driver.category_key === categoryKey);
  const subject = subjectLabel(scope);

  switch (insightType) {
    case 'spend_pace_ahead':
      return `${subject} ${`${scope}` === 'household' ? 'is' : 'are'} ${Math.abs(Number(pace?.delta_percent || 0))}% ahead of ${`${scope}` === 'household' ? 'its' : 'your'} usual pace for this point in the period.`;
    case 'spend_pace_behind':
      return `${subject} ${`${scope}` === 'household' ? 'is' : 'are'} ${Math.abs(Number(pace?.delta_percent || 0))}% below ${`${scope}` === 'household' ? 'its' : 'your'} usual pace for this point in the period.`;
    case 'budget_too_low':
      return `${`${scope}` === 'household' ? 'Projected household spend' : 'Your projected spend'} is ${formatCurrency(budget?.projected_over_under)} above budget, and recent history suggests this budget may be set too low.`;
    case 'budget_too_high':
      return `${`${scope}` === 'household' ? 'Recent household history' : 'Your recent history'} suggests this budget may be higher than ${`${scope}` === 'household' ? 'you usually need together' : 'you typically need'}.`;
    case 'top_category_driver':
      return highlightedDriver
        ? `${highlightedDriver.category_name} is running ${formatCurrency(Math.abs(highlightedDriver.delta_amount))} ${Number(highlightedDriver.delta_amount) >= 0 ? 'higher' : 'lower'} than ${`${scope}` === 'household' ? 'your shared' : 'your usual'} pace so far.`
        : 'This category is one of the main reasons the period is off your normal pace.';
    case 'one_offs_driving_variance':
      return 'A few unusual merchants are contributing more to this period than your recurring baseline normally would.';
    case 'recurring_cost_pressure':
      return 'Recurring purchases are contributing more extra spend than usual this period.';
    case 'projected_month_end_over_budget':
      return `${subject} ${`${scope}` === 'household' ? 'is' : 'are'} projected to finish about ${formatCurrency(projection?.projected_budget_delta)} above budget by month end based on ${`${scope}` === 'household' ? 'your shared' : 'your'} historical spending shape.`;
    case 'projected_month_end_under_budget':
      return `${subject} ${`${scope}` === 'household' ? 'is' : 'are'} projected to finish about ${formatCurrency(Math.abs(Number(projection?.projected_budget_delta || 0)))} under budget by month end based on ${`${scope}` === 'household' ? 'your shared' : 'your'} historical spending shape.`;
    case 'one_off_expense_skewing_projection':
      return 'An unusual purchase is materially lifting the all-in month-end projection above your baseline spend pattern.';
    case 'projected_category_surge': {
      const projectedCategory = (trend?.projection?.categories || []).find((category) => category.category_key === categoryKey)
        || trend?.projection?.categories?.[0];
      return projectedCategory
        ? `${projectedCategory.category_name} is tracking above its usual finish for this point in the period, even after accounting for your normal daily spend shape.`
        : 'This category is projected to finish above its usual baseline this period.';
    }
    case 'projected_category_under_baseline': {
      const projectedCategory = (trend?.projection?.categories || []).find((category) => category.category_key === categoryKey)
        || trend?.projection?.categories?.[0];
      return projectedCategory
        ? `${projectedCategory.category_name} is tracking below its usual finish for this point in the period, which leaves more room than usual in that category.`
        : 'This category is projected to finish below its usual baseline this period.';
    }
    default:
      return 'This view breaks down the trend data behind the insight.';
  }
}

export default function TrendDetailScreen() {
  const router = useRouter();
  const {
    scope = 'personal',
    month,
    insight_type: insightType = '',
    category_key: categoryKey = '',
    insight_metadata: insightMetadataParam = '',
    title,
    insight_id: insightId = '',
    mock = '',
  } = useLocalSearchParams();
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [unusualReviewStatus, setUnusualReviewStatus] = useState('');
  const [categoryReviewStatus, setCategoryReviewStatus] = useState('');
  const [recurringReviewStatus, setRecurringReviewStatus] = useState('');
  const [categoryExpenses, setCategoryExpenses] = useState([]);
  const [categoryExpensesLoading, setCategoryExpensesLoading] = useState(false);
  const primaryAction = useMemo(
    () => primaryActionForInsight({ insightType: `${insightType}`, scope: `${scope}`, month: `${month}`, categoryKey: `${categoryKey}`, trend }),
    [insightType, scope, month, categoryKey, trend]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!month) {
        setError('Missing trend period');
        setLoading(false);
        return;
      }
      if (`${mock}` === '1') {
        setTrend(buildMockTrend(scope, month));
        setError('');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const trendScope = `${scope}` === 'household' ? 'household' : 'personal';
        const params = new URLSearchParams({ scope: trendScope, month: `${month}` });
        const url = `/trends/summary?${params.toString()}`;
        const cacheKey = `cache:trends:${trendScope}:${month}`;
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const loader = `${month}` < currentMonth ? loadCacheOnly : (k, f, onD, onE) => loadWithCache(k, f, onD, onE, { ttlMs: 3 * 60 * 1000 });
        await loader(
          cacheKey,
          () => api.get(url),
          (data) => { if (!cancelled) { setTrend(data); setError(''); setLoading(false); } },
          (err) => { if (!cancelled) { setError(err.message || 'Could not load trend detail'); setLoading(false); } },
        );
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load trend detail');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [scope, month, mock]);

  const highlightedDriver = useMemo(
    () => trend?.pace?.top_drivers?.find((driver) => driver.category_key === categoryKey) || null,
    [trend, categoryKey]
  );
  const highlightedCategoryProjection = useMemo(
    () => (trend?.projection?.categories || []).find((category) => category.category_key === categoryKey)
      || trend?.projection?.categories?.[0]
      || null,
    [trend, categoryKey]
  );
  const unusualExpenses = useMemo(
    () => trend?.projection?.overall?.top_unusual_expenses || [],
    [trend]
  );
  const oneOffMerchants = useMemo(
    () => trend?.pace?.variance_breakdown?.top_one_off_merchants || [],
    [trend]
  );
  const supportsUnusualReview = ['one_offs_driving_variance', 'one_off_expense_skewing_projection'].includes(`${insightType}`);
  const supportsCategoryReview = ['top_category_driver', 'projected_category_surge', 'projected_category_under_baseline'].includes(`${insightType}`);
  const supportsRecurringReview = `${insightType}` === 'recurring_cost_pressure';
  const unusualDecisionBuckets = useMemo(() => {
    const likelyDiscount = [];
    const worthWatching = [];

    for (const expense of unusualExpenses) {
      const reason = `${expense.norm_reason || ''}`;
      if (reason.includes('novel') || reason.includes('rare')) {
        likelyDiscount.push(expense);
      } else {
        worthWatching.push(expense);
      }
    }

    return {
      likelyDiscount: likelyDiscount.slice(0, 3),
      worthWatching: worthWatching.slice(0, 3),
    };
  }, [unusualExpenses]);
  const insightMetadata = useMemo(() => {
    if (!insightMetadataParam) return {};
    try {
      return JSON.parse(`${insightMetadataParam}`);
    } catch {
      return {};
    }
  }, [insightMetadataParam]);
  const recurringSpikeSignals = useMemo(() => {
    if (`${mock}` === '1') {
      return [
        {
          group_key: 'mock-milk',
          item_name: 'Whole milk',
          latest_merchant: 'Whole Foods',
          latest_date: '2026-04-03',
          comparison_type: 'price',
          latest_value: 5.49,
          baseline_value: 4.19,
          delta_amount: 1.3,
          delta_percent: 31,
        },
        {
          group_key: 'mock-eggs',
          item_name: 'Eggs',
          latest_merchant: 'Trader Joe\'s',
          latest_date: '2026-04-04',
          comparison_type: 'price',
          latest_value: 6.2,
          baseline_value: 4.9,
          delta_amount: 1.3,
          delta_percent: 26.5,
        },
      ];
    }
    return Array.isArray(insightMetadata?.recurring_spike_signals)
      ? insightMetadata.recurring_spike_signals
      : [];
  }, [insightMetadata, mock]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategoryExpenses() {
      if (!month || !categoryKey || !supportsCategoryReview) {
        setCategoryExpensesLoading(false);
        setCategoryExpenses([]);
        return;
      }
      if (`${mock}` === '1') {
        setCategoryExpensesLoading(false);
        setCategoryExpenses(buildMockCategoryExpenses(categoryKey));
        return;
      }
      try {
        setCategoryExpensesLoading(true);
        const trendScope = `${scope}` === 'household' ? 'household' : 'personal';
        const params = new URLSearchParams({ month: `${month}`, category_id: `${categoryKey}` });
        const endpoint = trendScope === 'household' ? '/expenses/household' : '/expenses';
        const url = `${endpoint}?${params.toString()}`;
        const cacheKey = `cache:trends:category-expenses:${trendScope}:${month}:${categoryKey}`;
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const loader = `${month}` < currentMonth ? loadCacheOnly : (k, f, onD, onE) => loadWithCache(k, f, onD, onE, { ttlMs: 3 * 60 * 1000 });
        await loader(
          cacheKey,
          () => api.get(url),
          (rows) => { if (!cancelled) { setCategoryExpenses(Array.isArray(rows) ? rows.slice(0, 8) : []); setCategoryExpensesLoading(false); } },
          () => { if (!cancelled) { setCategoryExpenses([]); setCategoryExpensesLoading(false); } },
        );
      } catch {
        if (!cancelled) setCategoryExpenses([]);
      } finally {
        if (!cancelled) setCategoryExpensesLoading(false);
      }
    }

    loadCategoryExpenses();
    return () => { cancelled = true; };
  }, [categoryKey, month, mock, scope, supportsCategoryReview]);
  const categoryMerchantSummary = useMemo(() => {
    const totals = new Map();
    for (const expense of categoryExpenses) {
      const merchant = `${expense.merchant || 'Unknown merchant'}`.trim() || 'Unknown merchant';
      const current = totals.get(merchant) || { merchant, amount: 0, count: 0 };
      current.amount += Number(expense.amount || 0);
      current.count += 1;
      totals.set(merchant, current);
    }
    return [...totals.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
  }, [categoryExpenses]);
  const topMerchantShare = useMemo(() => {
    const total = categoryExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    if (!total || !categoryMerchantSummary.length) return 0;
    return Number(categoryMerchantSummary[0].amount || 0) / total;
  }, [categoryExpenses, categoryMerchantSummary]);

  async function submitFeedback(eventType) {
    if (!insightId || !eventType || feedbackStatus === eventType) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: eventType,
          metadata: {
            surface: 'trend_detail',
            scope: `${scope}`,
            month: `${month}`,
            insight_type: `${insightType}`,
            category_key: `${categoryKey}`,
          },
        }],
      });
      setFeedbackStatus(eventType);
    } catch {
      // non-fatal
    }
  }

  async function submitNegativeFeedback() {
    if (!insightId || !feedbackReason) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: 'not_helpful',
          metadata: {
            surface: 'trend_detail',
            scope: `${scope}`,
            month: `${month}`,
            insight_type: `${insightType}`,
            category_key: `${categoryKey}`,
            reason: feedbackReason,
            note: feedbackNote.trim() || null,
          },
        }],
      });
      setFeedbackStatus('not_helpful');
      setFeedbackReason('');
      setFeedbackNote('');
      setShowFeedbackSheet(false);
    } catch {
      // non-fatal
    }
  }

  async function submitUnusualReview(review) {
    if (!insightId || !review || unusualReviewStatus === review) return;
    try {
      const reviewTargetType = unusualExpenses.length ? 'expense' : oneOffMerchants.length ? 'merchant' : 'unknown';
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: 'acted',
          metadata: {
            surface: 'trend_detail',
            scope: `${scope}`,
            month: `${month}`,
            insight_type: `${insightType}`,
            category_key: `${categoryKey}`,
            review_type: 'unusual_purchase_review',
            unusual_review: review,
            review_target_type: reviewTargetType,
            review_target_count: unusualExpenses.length || oneOffMerchants.length || 0,
            historical_period_count: Number(trend?.projection?.overall?.historical_period_count || 0),
            projected_budget_delta: Number(trend?.projection?.overall?.projected_budget_delta || 0),
            top_unusual_expense_ids: unusualExpenses.map((expense) => expense.id).filter(Boolean),
            top_one_off_merchants: oneOffMerchants.map((merchant) => merchant.merchant_key).filter(Boolean),
          },
        }],
      });
      setUnusualReviewStatus(review);
    } catch {
      // non-fatal
    }
  }

  async function submitCategoryReview(review) {
    if (!insightId || !review || categoryReviewStatus === review) return;
    try {
      const category = highlightedCategoryProjection || highlightedDriver;
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: 'acted',
          metadata: {
            surface: 'trend_detail',
            scope: `${scope}`,
            month: `${month}`,
            insight_type: `${insightType}`,
            category_key: `${categoryKey}`,
            review_type: 'category_shift_review',
            category_review: review,
            category_name: category?.category_name || null,
            category_delta_amount: Number(
              category?.delta_amount
              ?? category?.projected_budget_delta
              ?? 0
            ),
            historical_period_count: Number(
              category?.historical_period_count
              ?? trend?.projection?.overall?.historical_period_count
              ?? 0
            ),
          },
        }],
      });
      setCategoryReviewStatus(review);
    } catch {
      // non-fatal
    }
  }

  async function submitRecurringReview(review) {
    if (!insightId || !review || recurringReviewStatus === review) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: 'acted',
          metadata: {
            surface: 'trend_detail',
            scope: `${scope}`,
            month: `${month}`,
            insight_type: `${insightType}`,
            category_key: `${categoryKey}`,
            review_type: 'recurring_pressure_review',
            recurring_review: review,
            recurring_delta_amount: Number(trend?.pace?.variance_breakdown?.recurring_delta_amount || 0),
            historical_period_count: Number(trend?.projection?.overall?.historical_period_count || 0),
            projected_budget_delta: Number(trend?.projection?.overall?.projected_budget_delta || 0),
          },
        }],
      });
      setRecurringReviewStatus(review);
    } catch {
      // non-fatal
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: titleForInsightType(`${insightType}`, title) }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#f5f5f5" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : trend ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.scopeChip}>{`${scope}` === 'household' ? 'Household' : 'You'}</Text>
              <Text style={styles.heroTitle}>{titleForInsightType(`${insightType}`, title)}</Text>
              <Text style={styles.heroCopy}>{summaryCopy({ insightType: `${insightType}`, trend, categoryKey: `${categoryKey}`, scope: `${scope}` })}</Text>
              <Text style={styles.heroContext}>{sharedContextCopy(scope)}</Text>
            </View>

            {`${scope}` === 'household' ? (
              <View style={styles.sharedContextCard}>
                <Text style={styles.cardTitle}>Shared context</Text>
                <Text style={styles.metricRow}>
                  This insight is about the household&apos;s combined spending pattern, not just one person&apos;s activity.
                </Text>
              </View>
            ) : null}

            {primaryAction ? (
              <View style={styles.actionCard}>
                <View style={styles.actionText}>
                  <Text style={styles.cardTitle}>What to do next</Text>
                  <Text style={styles.actionTitle}>{primaryAction.title}</Text>
                  <Text style={styles.actionBody}>{primaryAction.body}</Text>
                </View>
                {primaryAction.route ? (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => router.push(primaryAction.route)}
                  >
                    <Text style={styles.actionButtonText}>{primaryAction.cta}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {supportsUnusualReview ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Review this unusual spend</Text>
                <Text style={styles.feedbackCopy}>
                  Help Adlo learn whether this really was a one-off, something expected, or a new normal to learn from.
                </Text>
                {unusualExpenses.length ? (
                  <>
                    <Text style={styles.sectionEyebrow}>How to think about this month</Text>
                    {unusualDecisionBuckets.likelyDiscount.length ? (
                      <>
                        <Text style={styles.metricRow}>
                          Probably safe to mentally discount: these look more like isolated one-offs than a real shift in your normal month shape.
                        </Text>
                        <View style={styles.reviewList}>
                          {unusualDecisionBuckets.likelyDiscount.map((expense) => (
                            <View key={`discount:${expense.id || `${expense.merchant}:${expense.amount}`}`} style={styles.reviewRow}>
                              <View style={styles.driverText}>
                                <Text style={styles.driverName}>{expense.merchant}</Text>
                                <Text style={styles.driverMeta}>
                                  {expense.category_name || 'Uncategorized'} · {expense.norm_reason?.replace(/_/g, ' ') || 'unusual'}
                                </Text>
                              </View>
                              <Text style={styles.driverDelta}>{formatCurrency(expense.amount)}</Text>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : null}
                    {unusualDecisionBuckets.worthWatching.length ? (
                      <>
                        <Text style={styles.metricRow}>
                          Worth watching if it repeats: these are unusual, but they may be closer to a real spending-pattern shift if they show up again.
                        </Text>
                        <View style={styles.reviewList}>
                          {unusualDecisionBuckets.worthWatching.map((expense) => (
                            <View key={`watch:${expense.id || `${expense.merchant}:${expense.amount}`}`} style={styles.reviewRow}>
                              <View style={styles.driverText}>
                                <Text style={styles.driverName}>{expense.merchant}</Text>
                                <Text style={styles.driverMeta}>
                                  {expense.category_name || 'Uncategorized'} · {expense.norm_reason?.replace(/_/g, ' ') || 'unusual'}
                                </Text>
                              </View>
                              <Text style={styles.driverDelta}>{formatCurrency(expense.amount)}</Text>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : null}
                  </>
                ) : null}
                {unusualExpenses.length ? (
                  <View style={styles.reviewList}>
                    {unusualExpenses.map((expense) => (
                      <View key={expense.id || `${expense.merchant}:${expense.amount}`} style={styles.reviewRow}>
                        <View style={styles.driverText}>
                          <Text style={styles.driverName}>{expense.merchant}</Text>
                          <Text style={styles.driverMeta}>
                            {expense.category_name || 'Uncategorized'} · {expense.norm_reason?.replace(/_/g, ' ') || 'unusual'}
                          </Text>
                        </View>
                        <Text style={styles.driverDelta}>{formatCurrency(expense.amount)}</Text>
                      </View>
                    ))}
                  </View>
                ) : oneOffMerchants.length ? (
                  <View style={styles.reviewList}>
                    {oneOffMerchants.map((merchant) => (
                      <View key={merchant.merchant_key} style={styles.reviewRow}>
                        <View style={styles.driverText}>
                          <Text style={styles.driverName}>{merchant.merchant_name}</Text>
                          <Text style={styles.driverMeta}>One-off merchant lift</Text>
                        </View>
                        <Text style={styles.driverDelta}>{formatCurrency(merchant.delta_amount)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={styles.reasonList}>
                  {[
                    { key: 'truly_one_off', label: 'Truly one-off' },
                    { key: 'expected', label: 'Expected spend' },
                    { key: 'becoming_normal', label: 'Becoming normal' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.reasonChip, unusualReviewStatus === option.key && styles.reasonChipActive]}
                      onPress={() => submitUnusualReview(option.key)}
                    >
                      <Text style={[styles.reasonChipText, unusualReviewStatus === option.key && styles.reasonChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {unusualReviewStatus ? (
                  <Text style={styles.feedbackNote}>Saved. Adlo can use this to get better at spotting what should and should not shape future guidance.</Text>
                ) : null}
              </View>
            ) : null}

            {supportsCategoryReview ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Review this category shift</Text>
                <Text style={styles.feedbackCopy}>
                  Help Adlo learn whether this category move feels temporary, expected, or like a real spending pattern shift.
                </Text>
                {categoryExpensesLoading ? (
                  <ActivityIndicator color="#f5f5f5" style={styles.inlineLoader} />
                ) : categoryExpenses.length ? (
                  <>
                    <Text style={styles.sectionEyebrow}>What&apos;s driving it</Text>
                    <Text style={styles.metricRow}>
                      {topMerchantShare >= 0.5
                        ? `${categoryMerchantSummary[0]?.merchant || 'One merchant'} is doing most of the lifting in this category right now.`
                        : 'This move looks spread across a few merchants instead of coming from just one place.'}
                    </Text>
                    <View style={styles.reviewList}>
                      {categoryMerchantSummary.map((merchant) => (
                        <View key={merchant.merchant} style={styles.reviewRow}>
                          <View style={styles.driverText}>
                            <Text style={styles.driverName}>{merchant.merchant}</Text>
                            <Text style={styles.driverMeta}>
                              {merchant.count} {merchant.count === 1 ? 'purchase' : 'purchases'}
                            </Text>
                          </View>
                          <Text style={styles.driverDelta}>{formatCurrency(merchant.amount)}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.sectionEyebrow}>Recent purchases in this category</Text>
                    <View style={styles.reviewList}>
                      {categoryExpenses.map((expense) => (
                        <View key={expense.id || `${expense.merchant}:${expense.date}:${expense.amount}`} style={styles.reviewRow}>
                          <View style={styles.driverText}>
                            <Text style={styles.driverName}>{expense.merchant || 'Unknown merchant'}</Text>
                            <Text style={styles.driverMeta}>
                              {formatShortDate(expense.date)}
                              {expense.user_name ? ` · ${expense.user_name}` : ''}
                            </Text>
                          </View>
                          <Text style={styles.driverDelta}>{formatCurrency(expense.amount)}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}
                {(highlightedCategoryProjection || highlightedDriver) ? (
                  <View style={styles.reviewList}>
                    <View style={styles.reviewRow}>
                      <View style={styles.driverText}>
                        <Text style={styles.driverName}>
                          {(highlightedCategoryProjection || highlightedDriver)?.category_name || 'Category'}
                        </Text>
                        <Text style={styles.driverMeta}>
                          {`${insightType}` === 'projected_category_under_baseline'
                            ? 'Tracking below its usual finish'
                            : 'Tracking above its usual finish'}
                        </Text>
                      </View>
                      <Text style={styles.driverDelta}>
                        {formatCurrency(
                          (highlightedCategoryProjection || highlightedDriver)?.delta_amount
                            ?? (highlightedCategoryProjection || highlightedDriver)?.projected_budget_delta
                        )}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.reasonList}>
                  {[
                    { key: 'temporary_swing', label: 'Temporary swing' },
                    { key: 'expected_pattern', label: 'Expected pattern' },
                    { key: 'new_pattern', label: 'New pattern' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.reasonChip, categoryReviewStatus === option.key && styles.reasonChipActive]}
                      onPress={() => submitCategoryReview(option.key)}
                    >
                      <Text style={[styles.reasonChipText, categoryReviewStatus === option.key && styles.reasonChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {categoryReviewStatus ? (
                  <Text style={styles.feedbackNote}>Saved. Adlo can use this to get better at telling normal category patterns from changes that really matter.</Text>
                ) : null}
              </View>
            ) : null}

            {supportsRecurringReview ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Review this recurring pressure</Text>
                <Text style={styles.feedbackCopy}>
                  Help Adlo learn whether this looks like a temporary recurring price spike, an expected cost, or a real new pressure to keep watching.
                </Text>
                {recurringSpikeSignals.length ? (
                  <>
                    <Text style={styles.sectionEyebrow}>What&apos;s driving it</Text>
                    <View style={styles.reviewList}>
                      {recurringSpikeSignals.map((signal) => (
                        <View key={signal.group_key || `${signal.item_name}:${signal.latest_merchant}`} style={styles.reviewRow}>
                          <View style={styles.driverText}>
                            <Text style={styles.driverName}>{signal.item_name || 'Recurring item'}</Text>
                            <Text style={styles.driverMeta}>
                              {signal.latest_merchant || 'Latest purchase'}
                              {signal.latest_date ? ` · ${formatShortDate(signal.latest_date)}` : ''}
                            </Text>
                          </View>
                          <Text style={styles.driverDelta}>
                            +{formatCurrency(signal.delta_amount)}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.metricRow}>
                      Biggest current lift: {recurringSpikeSignals[0]?.item_name || 'Recurring item'} is about{' '}
                      {formatCurrency(recurringSpikeSignals[0]?.latest_value)} now vs {formatCurrency(recurringSpikeSignals[0]?.baseline_value)} usual.
                    </Text>
                  </>
                ) : null}
                <View style={styles.reviewList}>
                  <View style={styles.reviewRow}>
                    <View style={styles.driverText}>
                      <Text style={styles.driverName}>Recurring cost pressure</Text>
                      <Text style={styles.driverMeta}>Extra recurring lift versus your recent baseline</Text>
                    </View>
                    <Text style={styles.driverDelta}>
                      {formatCurrency(trend?.pace?.variance_breakdown?.recurring_delta_amount)}
                    </Text>
                  </View>
                </View>
                <View style={styles.reasonList}>
                  {[
                    { key: 'temporary_spike', label: 'Temporary spike' },
                    { key: 'expected_cost', label: 'Expected cost' },
                    { key: 'new_pressure', label: 'New pressure' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.reasonChip, recurringReviewStatus === option.key && styles.reasonChipActive]}
                      onPress={() => submitRecurringReview(option.key)}
                    >
                      <Text style={[styles.reasonChipText, recurringReviewStatus === option.key && styles.reasonChipTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {recurringReviewStatus ? (
                  <Text style={styles.feedbackNote}>Saved. Adlo can use this to learn when recurring cost changes are worth treating as real pressure.</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Period snapshot</Text>
              <Text style={styles.metricRow}>Current spend to date: {formatCurrency(trend.pace?.current_spend_to_date)}</Text>
              <Text style={styles.metricRow}>Historical average to date: {formatCurrency(trend.pace?.historical_spend_to_date_avg)}</Text>
              <Text style={styles.metricRow}>Delta: {formatCurrency(trend.pace?.delta_amount)} · {formatPercent(trend.pace?.delta_percent)}</Text>
              <Text style={styles.metricRow}>Projected period total: {formatCurrency(trend.pace?.projected_period_total)}</Text>
              <Text style={styles.metricRow}>Historical periods used: {trend.pace?.historical_period_count ?? 0}</Text>
              <Text style={styles.metricRow}>Data start: {trend.period?.data_start_date || '—'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Budget context</Text>
              <Text style={styles.metricRow}>Budget limit: {formatCurrency(trend.budget_adherence?.budget_limit)}</Text>
              <Text style={styles.metricRow}>Projected over / under: {formatCurrency(trend.budget_adherence?.projected_over_under)}</Text>
              <Text style={styles.metricRow}>Budget fit: {trend.budget_adherence?.budget_fit || '—'}</Text>
              <Text style={styles.metricRow}>Historical periods used: {trend.budget_adherence?.historical_period_count ?? 0}</Text>
            </View>

            {trend.projection?.overall ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Month-end projection</Text>
                <Text style={styles.metricRow}>Adjusted projection: {formatCurrency(trend.projection.overall.adjusted_projected_total)}</Text>
                <Text style={styles.metricRow}>Baseline projection: {formatCurrency(trend.projection.overall.baseline_projected_total)}</Text>
                <Text style={styles.metricRow}>Unusual spend to date: {formatCurrency(trend.projection.overall.unusual_spend_to_date)}</Text>
                <Text style={styles.metricRow}>Normal spend to date: {formatCurrency(trend.projection.overall.normal_spend_to_date)}</Text>
                <Text style={styles.metricRow}>Projected budget delta: {formatCurrency(trend.projection.overall.projected_budget_delta)}</Text>
                <Text style={styles.metricRow}>Historical spend share by today: {formatPercent((Number(trend.projection.overall.historical_expected_share_by_day || 0) * 100) - 0)}</Text>
                <Text style={styles.metricRow}>Projection confidence: {trend.projection.overall.confidence || '—'}</Text>
              </View>
            ) : null}

            {(trend.projection?.categories || []).length ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Projected category finish</Text>
                {trend.projection.categories.map((category) => (
                  <View
                    key={category.category_key}
                    style={[
                      styles.driverRow,
                      `${categoryKey}` && category.category_key === `${categoryKey}` && styles.driverRowHighlight,
                    ]}
                  >
                    <View style={styles.driverText}>
                      <Text style={styles.driverName}>{category.category_name}</Text>
                      <Text style={styles.driverMeta}>
                        Baseline {formatCurrency(category.baseline_projected_total)} · Adjusted {formatCurrency(category.adjusted_projected_total)}
                      </Text>
                    </View>
                    <Text style={styles.driverDelta}>
                      {formatCurrency(Number(category.adjusted_projected_total || 0) - Number(category.baseline_projected_total || 0))}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top drivers</Text>
              {(trend.pace?.top_drivers || []).length ? (
                trend.pace.top_drivers.map((driver) => (
                  <View
                    key={driver.category_key}
                    style={[styles.driverRow, `${categoryKey}` && driver.category_key === `${categoryKey}` && styles.driverRowHighlight]}
                  >
                    <View style={styles.driverText}>
                      <Text style={styles.driverName}>{driver.category_name}</Text>
                      <Text style={styles.driverMeta}>
                        {formatCurrency(driver.current_spend_to_date)} now vs {formatCurrency(driver.historical_spend_to_date_avg)} usual
                      </Text>
                    </View>
                    <Text style={styles.driverDelta}>
                      {formatCurrency(driver.delta_amount)} · {formatPercent(driver.delta_percent)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No strong category drivers yet.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>One-offs vs recurring</Text>
              <Text style={styles.metricRow}>One-off delta: {formatCurrency(trend.pace?.variance_breakdown?.one_off_delta_amount)}</Text>
              <Text style={styles.metricRow}>Recurring delta: {formatCurrency(trend.pace?.variance_breakdown?.recurring_delta_amount)}</Text>
              {(trend.pace?.variance_breakdown?.top_one_off_merchants || []).length ? (
                <View style={styles.oneOffList}>
                  {trend.pace.variance_breakdown.top_one_off_merchants.map((merchant) => (
                    <Text key={merchant.merchant_key} style={styles.oneOffRow}>
                      {merchant.merchant_name}: {formatCurrency(merchant.delta_amount)}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>No notable one-off merchants in this period.</Text>
              )}
            </View>

            {trend.projection?.overall?.top_unusual_expenses?.length ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Top unusual expenses</Text>
                {trend.projection.overall.top_unusual_expenses.map((expense) => (
                  <View key={expense.id || `${expense.merchant}:${expense.date}`} style={styles.driverRow}>
                    <View style={styles.driverText}>
                      <Text style={styles.driverName}>{expense.merchant}</Text>
                      <Text style={styles.driverMeta}>
                        {expense.category_name || 'Uncategorized'} · {expense.norm_reason?.replace(/_/g, ' ') || 'unusual'}
                      </Text>
                    </View>
                    <Text style={styles.driverDelta}>{formatCurrency(expense.amount)}</Text>
                  </View>
                ))}
                <Text style={styles.emptyText}>
                  Baseline projection excludes these from the forward run-rate, while adjusted projection counts what has already happened this month.
                </Text>
              </View>
            ) : null}

            {highlightedDriver ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Why this category matters</Text>
                <Text style={styles.metricRow}>
                  {highlightedDriver.category_name} is contributing {formatCurrency(Math.abs(highlightedDriver.delta_amount))}{' '}
                  {Number(highlightedDriver.delta_amount) >= 0 ? 'above' : 'below'} your usual pace.
                </Text>
              </View>
            ) : null}

            {highlightedCategoryProjection ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Category projection detail</Text>
                <Text style={styles.metricRow}>Category: {highlightedCategoryProjection.category_name}</Text>
                <Text style={styles.metricRow}>Current spend to date: {formatCurrency(highlightedCategoryProjection.current_spend_to_date)}</Text>
                <Text style={styles.metricRow}>Baseline finish: {formatCurrency(highlightedCategoryProjection.baseline_projected_total)}</Text>
                <Text style={styles.metricRow}>Adjusted finish: {formatCurrency(highlightedCategoryProjection.adjusted_projected_total)}</Text>
                <Text style={styles.metricRow}>Unusual spend to date: {formatCurrency(highlightedCategoryProjection.unusual_spend_to_date)}</Text>
                <Text style={styles.metricRow}>Confidence: {highlightedCategoryProjection.confidence || '—'}</Text>
              </View>
            ) : null}

            {insightId ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Was this helpful?</Text>
                <Text style={styles.feedbackCopy}>
                  Your feedback helps Adlo learn which kinds of {`${scope}` === 'household' ? 'shared' : 'personal'} insights are actually useful.
                </Text>
                <View style={styles.feedbackRow}>
                  <TouchableOpacity
                    style={[styles.feedbackButton, feedbackStatus === 'helpful' && styles.feedbackButtonActive]}
                    onPress={() => submitFeedback('helpful')}
                  >
                    <Text style={[styles.feedbackButtonText, feedbackStatus === 'helpful' && styles.feedbackButtonTextActive]}>Helpful</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.feedbackButton, feedbackStatus === 'not_helpful' && styles.feedbackButtonActive]}
                    onPress={() => {
                      setFeedbackReason('');
                      setFeedbackNote('');
                      setShowFeedbackSheet(true);
                    }}
                  >
                    <Text style={[styles.feedbackButtonText, feedbackStatus === 'not_helpful' && styles.feedbackButtonTextActive]}>Not helpful</Text>
                  </TouchableOpacity>
                </View>
                {feedbackStatus ? (
                  <Text style={styles.feedbackNote}>Thanks. We&apos;ll use this to tune future insights.</Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <Modal
        visible={showFeedbackSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFeedbackSheet(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>What was off?</Text>
            <Text style={styles.modalCopy}>
              This helps Adlo learn how to tune future insights for you.
            </Text>
            <View style={styles.reasonList}>
              {FEEDBACK_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  style={[styles.reasonChip, feedbackReason === reason.key && styles.reasonChipActive]}
                  onPress={() => setFeedbackReason(reason.key)}
                >
                  <Text style={[styles.reasonChipText, feedbackReason === reason.key && styles.reasonChipTextActive]}>
                    {reason.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={feedbackNote}
              onChangeText={setFeedbackNote}
              placeholder="What should Adlo know instead?"
              placeholderTextColor="#6f6f6f"
              style={styles.noteInput}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={() => {
                  setFeedbackReason('');
                  setFeedbackNote('');
                  setShowFeedbackSheet(false);
                }}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryButton, !feedbackReason && styles.modalPrimaryButtonDisabled]}
                onPress={submitNegativeFeedback}
                disabled={!feedbackReason}
              >
                <Text style={styles.modalPrimaryText}>Send feedback</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#999', fontSize: 15 },
  inlineLoader: { marginTop: 8, marginBottom: 4 },
  sectionEyebrow: { color: '#8e8e93', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 8 },
  hero: { gap: 8, marginBottom: 8 },
  scopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#161616',
    color: '#d4d4d4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitle: { fontSize: 30, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  heroCopy: { fontSize: 15, color: '#b5b5b5', lineHeight: 22 },
  heroContext: { fontSize: 13, color: '#8ca7bf', lineHeight: 18 },
  sharedContextCard: {
    backgroundColor: '#101b24',
    borderWidth: 1,
    borderColor: '#1a2f40',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  actionCard: {
    backgroundColor: '#12161b',
    borderWidth: 1,
    borderColor: '#253140',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  actionText: { gap: 6 },
  actionTitle: { fontSize: 18, color: '#eef5fb', fontWeight: '600' },
  actionBody: { fontSize: 14, color: '#9eb1c5', lineHeight: 20 },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonText: { color: '#000', fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  metricRow: { fontSize: 14, color: '#e5e5e5' },
  driverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  driverRowHighlight: {
    backgroundColor: '#151515',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  driverText: { flex: 1 },
  driverName: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  driverMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  driverDelta: { fontSize: 13, color: '#d4d4d4', textAlign: 'right' },
  oneOffList: { gap: 6, marginTop: 4 },
  oneOffRow: { fontSize: 14, color: '#e5e5e5' },
  reviewList: { gap: 10 },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  emptyText: { fontSize: 13, color: '#777' },
  feedbackRow: { flexDirection: 'row', gap: 10 },
  feedbackCopy: { fontSize: 13, color: '#9d9d9d', lineHeight: 18 },
  feedbackButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#151515',
    paddingVertical: 12,
    alignItems: 'center',
  },
  feedbackButtonActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  feedbackButtonText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '600',
  },
  feedbackButtonTextActive: {
    color: '#000',
  },
  feedbackNote: {
    fontSize: 12,
    color: '#7fcf9f',
  },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#232323',
    padding: 18,
    gap: 14,
  },
  modalTitle: {
    fontSize: 20,
    color: '#f5f5f5',
    fontWeight: '600',
  },
  modalCopy: {
    fontSize: 14,
    color: '#a1a1a1',
    lineHeight: 20,
  },
  reasonList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reasonChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reasonChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  reasonChipText: {
    color: '#d7d7d7',
    fontSize: 13,
    fontWeight: '600',
  },
  reasonChipTextActive: {
    color: '#000',
  },
  noteInput: {
    minHeight: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    backgroundColor: '#151515',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#f5f5f5',
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalSecondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalSecondaryText: {
    color: '#bcbcbc',
    fontSize: 14,
    fontWeight: '600',
  },
  modalPrimaryButton: {
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.4,
  },
  modalPrimaryText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
});
