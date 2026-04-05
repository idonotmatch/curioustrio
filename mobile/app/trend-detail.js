import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../services/api';

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
    default:
      return 'Trend detail';
  }
}

function summaryCopy({ insightType, trend, categoryKey }) {
  const pace = trend?.pace;
  const budget = trend?.budget_adherence;
  const highlightedDriver = trend?.pace?.top_drivers?.find((driver) => driver.category_key === categoryKey);

  switch (insightType) {
    case 'spend_pace_ahead':
      return `You are ${Math.abs(Number(pace?.delta_percent || 0))}% ahead of your usual pace for this point in the period.`;
    case 'spend_pace_behind':
      return `You are ${Math.abs(Number(pace?.delta_percent || 0))}% below your usual pace for this point in the period.`;
    case 'budget_too_low':
      return `Your projected spend is ${formatCurrency(budget?.projected_over_under)} above budget, and your recent history suggests this budget may be set too low.`;
    case 'budget_too_high':
      return `Your recent history suggests this budget may be higher than you typically need.`;
    case 'top_category_driver':
      return highlightedDriver
        ? `${highlightedDriver.category_name} is running ${formatCurrency(Math.abs(highlightedDriver.delta_amount))} ${Number(highlightedDriver.delta_amount) >= 0 ? 'higher' : 'lower'} than your usual pace so far.`
        : 'This category is one of the main reasons the period is off your normal pace.';
    case 'one_offs_driving_variance':
      return 'A few unusual merchants are contributing more to this period than your recurring baseline normally would.';
    case 'recurring_cost_pressure':
      return 'Recurring purchases are contributing more extra spend than usual this period.';
    default:
      return 'This view breaks down the trend data behind the insight.';
  }
}

export default function TrendDetailScreen() {
  const {
    scope = 'personal',
    month,
    insight_type: insightType = '',
    category_key: categoryKey = '',
    title,
    insight_id: insightId = '',
  } = useLocalSearchParams();
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!month) {
        setError('Missing trend period');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const params = new URLSearchParams({
          scope: `${scope}` === 'household' ? 'household' : 'personal',
          month: `${month}`,
        });
        const data = await api.get(`/trends/summary?${params.toString()}`);
        if (!cancelled) {
          setTrend(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load trend detail');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [scope, month]);

  const highlightedDriver = useMemo(
    () => trend?.pace?.top_drivers?.find((driver) => driver.category_key === categoryKey) || null,
    [trend, categoryKey]
  );

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
              <Text style={styles.heroCopy}>{summaryCopy({ insightType: `${insightType}`, trend, categoryKey: `${categoryKey}` })}</Text>
            </View>

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

            {highlightedDriver ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Why this category matters</Text>
                <Text style={styles.metricRow}>
                  {highlightedDriver.category_name} is contributing {formatCurrency(Math.abs(highlightedDriver.delta_amount))}{' '}
                  {Number(highlightedDriver.delta_amount) >= 0 ? 'above' : 'below'} your usual pace.
                </Text>
              </View>
            ) : null}

            {insightId ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Was this helpful?</Text>
                <Text style={styles.feedbackCopy}>
                  Your feedback helps Adlo learn which kinds of insights are actually useful for you.
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
