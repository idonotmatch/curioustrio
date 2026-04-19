import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { consumeNavigationPayload } from '../services/navigationPayloadStore';

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
  return `${Math.abs(Number(value)).toFixed(0)}%`;
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return `${value}`.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseMetadata(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parsePayload(value, fallback = null) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function signalSummary(insightType, metadata = {}, history = null, fallbackBody = '') {
  const itemName = metadata.item_name || history?.item_name || 'This item';
  const latestMerchant = metadata.latest_merchant || history?.purchases?.[history.purchases.length - 1]?.merchant || 'your usual merchant';
  const cheapestMerchant = metadata.cheaper_merchant || history?.merchant_price_history?.[0]?.merchant || null;
  const deltaPercent = formatPercent(metadata.delta_percent);
  const medianAmount = history?.median_amount != null ? formatCurrency(history.median_amount) : null;
  const medianUnitPrice = history?.median_unit_price != null ? formatCurrency(history.median_unit_price) : null;

  switch (`${insightType || ''}`) {
    case 'recurring_price_spike':
      return {
        whatChanged: fallbackBody || `${itemName} came in above your usual price this time.`,
        whyItMatters: `${latestMerchant} was about ${deltaPercent} above your recent baseline${medianAmount !== '—' ? ` of ${medianAmount}` : ''}.`,
        nextStep: 'Check whether this was a one-off high price or whether it is worth changing where or when you buy it.',
      };
    case 'buy_soon_better_price':
      return {
        whatChanged: fallbackBody || `${itemName} is currently available below your usual price.`,
        whyItMatters: cheapestMerchant
          ? `${cheapestMerchant} is running about ${deltaPercent} below your usual ${metadata.comparison_type === 'unit_price' ? 'unit price' : 'price'}.`
          : `A recent observation suggests a better-than-usual price for this item.`,
        nextStep: 'If you actually need it soon, this is a good time to compare merchants before you buy.',
      };
    case 'recurring_repurchase_due':
      return {
        whatChanged: fallbackBody || `${itemName} looks close to its usual repurchase window.`,
        whyItMatters: `You typically buy this every ${metadata.average_gap_days || history?.average_gap_days || '—'} days, so timing is part of keeping this spend predictable.`,
        nextStep: 'Use the purchase history below to decide whether this still belongs in your normal routine or can wait.',
      };
    case 'recurring_restock_window':
      return {
        whatChanged: fallbackBody || `${itemName} could fit within the room you still have this period.`,
        whyItMatters: `You may have roughly ${formatCurrency(metadata.projected_headroom_amount)} of headroom left, and this item often lands around ${medianAmount || 'your usual price'}.`,
        nextStep: 'If this is a staple, this is a good moment to decide intentionally instead of getting surprised later.',
      };
    case 'recurring_cost_pressure':
      return {
        whatChanged: fallbackBody || `${itemName} is part of a recurring cost pattern that is getting more expensive.`,
        whyItMatters: medianUnitPrice !== '—'
          ? `Your recent median unit price is around ${medianUnitPrice}, which makes small changes add up faster over time.`
          : `Small repeated price increases can quietly drive a meaningful share of month-to-month pressure.`,
        nextStep: 'Review which merchant and purchase timing are actually creating the squeeze before changing your routine.',
      };
    default:
      return {
        whatChanged: fallbackBody || `${itemName} stands out in your recurring purchase history.`,
        whyItMatters: 'This is one of the few places where a small habit or merchant change can compound over time.',
        nextStep: 'Use the history below to decide whether the pattern is worth acting on now.',
      };
  }
}

export default function RecurringItemScreen() {
  const {
    group_key: groupKey,
    scope = 'household',
    title,
    insight_id: insightId = '',
    insight_type: insightType = '',
    body = '',
    metadata: metadataParam = '',
    preload_history: preloadHistoryParam = '',
    payload_key: payloadKeyParam = '',
  } = useLocalSearchParams();
  const navPayload = useMemo(
    () => consumeNavigationPayload(Array.isArray(payloadKeyParam) ? payloadKeyParam[0] : payloadKeyParam, null),
    [payloadKeyParam]
  );
  const preloadHistory = useMemo(
    () => navPayload?.preloadHistory
      || parsePayload(Array.isArray(preloadHistoryParam) ? preloadHistoryParam[0] : preloadHistoryParam, null),
    [navPayload, preloadHistoryParam]
  );
  const [history, setHistory] = useState(preloadHistory || null);
  const [loading, setLoading] = useState(!preloadHistory);
  const [error, setError] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');
  const metadata = useMemo(
    () => navPayload?.metadata || parseMetadata(Array.isArray(metadataParam) ? metadataParam[0] : metadataParam),
    [metadataParam, navPayload]
  );
  const summary = useMemo(
    () => signalSummary(Array.isArray(insightType) ? insightType[0] : insightType, metadata, history, Array.isArray(body) ? body[0] : body),
    [body, history, insightType, metadata]
  );
  const merchantPriceHistory = Array.isArray(history?.merchant_price_history) ? history.merchant_price_history : [];
  const purchaseHistory = Array.isArray(history?.purchases) ? history.purchases : [];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!groupKey) {
        setError('Missing recurring item');
        setLoading(false);
        return;
      }
      const normalizedScope = `${Array.isArray(scope) ? scope[0] : scope}` === 'personal' ? 'personal' : 'household';
      const cacheKey = `cache:recurring-item:${normalizedScope}:${groupKey}`;
      try {
        if (!cancelled && !preloadHistory) setLoading(true);
        await loadWithCache(
          cacheKey,
          () => api.get(`/recurring/item-history?group_key=${encodeURIComponent(groupKey)}&scope=${encodeURIComponent(normalizedScope)}`),
          (data) => {
            if (cancelled) return;
            setHistory(data);
            setError('');
            setLoading(false);
          },
          (err) => {
            if (cancelled) return;
            setError(err?.message || 'Could not load recurring item history');
            setLoading(false);
          }
        );
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load recurring item history');
      } finally {
        if (!cancelled && preloadHistory) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupKey, preloadHistory, scope]);

  async function submitFeedback(eventType) {
    if (!insightId || !eventType || feedbackStatus === eventType) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: eventType,
          metadata: {
            surface: 'recurring_item_detail',
            group_key: `${groupKey || ''}`,
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
            surface: 'recurring_item_detail',
            group_key: `${groupKey || ''}`,
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
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: title || 'Recurring item', headerBackTitle: 'Summary' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#f5f5f5" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : history ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.itemName}>{history.item_name}</Text>
              {history.brand ? <Text style={styles.subtle}>{history.brand}</Text> : null}
              <Text style={styles.heroStat}>
                Every {history.average_gap_days || '—'} days · {history.occurrence_count} purchases
              </Text>
              <Text style={styles.heroStat}>
                Median price {formatCurrency(history.median_amount)}
                {history.median_unit_price != null ? ` · ${formatCurrency(history.median_unit_price)} / unit` : ''}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>What changed</Text>
              <Text style={styles.detailTitle}>{summary.whatChanged}</Text>
              <Text style={styles.cardCopy}>{summary.whyItMatters}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Next step</Text>
              <Text style={styles.cardTitle}>What to do next</Text>
              <Text style={styles.cardCopy}>{summary.nextStep}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Timing</Text>
              <Text style={styles.cardTitle}>Cadence and coverage</Text>
              <View style={styles.metricList}>
                <View style={styles.metricRow}>
                  <Text style={styles.metricLabel}>Last purchased</Text>
                  <Text style={styles.metricValue}>{formatShortDate(history.last_purchased_at)}</Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={styles.metricLabel}>Next expected</Text>
                  <Text style={styles.metricValue}>{formatShortDate(history.next_expected_date)}</Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={styles.metricLabel}>Merchants</Text>
                  <Text style={styles.metricValue}>{(history.merchants || []).join(', ') || '—'}</Text>
                </View>
              </View>
            </View>

            {merchantPriceHistory.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardEyebrow}>Merchant comparison</Text>
                <Text style={styles.cardTitle}>Where this item tends to land</Text>
                {merchantPriceHistory.map((entry) => (
                  <View key={`${entry.merchant}:${entry.occurrence_count}`} style={styles.purchaseRow}>
                    <View>
                      <Text style={styles.purchaseMerchant}>{entry.merchant || 'Unknown merchant'}</Text>
                      <Text style={styles.purchaseDate}>{entry.occurrence_count} purchases</Text>
                    </View>
                    <View style={styles.purchaseRight}>
                      <Text style={styles.purchaseAmount}>{formatCurrency(entry.median_amount)}</Text>
                      {entry.median_unit_price != null ? (
                        <Text style={styles.purchaseUnit}>{formatCurrency(entry.median_unit_price)} / unit</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Supporting activity</Text>
              <Text style={styles.cardTitle}>Recent purchases</Text>
              {purchaseHistory.map((purchase) => (
                <View key={`${purchase.date}:${purchase.merchant}:${purchase.item_amount}`} style={styles.purchaseRow}>
                  <View>
                    <Text style={styles.purchaseMerchant}>{purchase.merchant || 'Unknown merchant'}</Text>
                    <Text style={styles.purchaseDate}>{purchase.date}</Text>
                  </View>
                  <View style={styles.purchaseRight}>
                    <Text style={styles.purchaseAmount}>{formatCurrency(purchase.item_amount)}</Text>
                    {purchase.estimated_unit_price != null ? (
                      <Text style={styles.purchaseUnit}>{formatCurrency(purchase.estimated_unit_price)} / unit</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>

            {insightId ? (
              <View style={styles.card}>
                <Text style={styles.cardEyebrow}>Feedback</Text>
                <Text style={styles.cardTitle}>Was this helpful?</Text>
                <Text style={styles.feedbackCopy}>
                  Your feedback helps Adlo learn which recurring signals are worth surfacing for you.
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
              This helps Adlo learn which recurring signals are mistimed, noisy, or inaccurate for you.
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
  hero: { gap: 6, marginBottom: 8 },
  itemName: { fontSize: 30, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  subtle: { fontSize: 14, color: '#888' },
  heroStat: { fontSize: 14, color: '#b5b5b5' },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardEyebrow: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { fontSize: 16, color: '#f5f5f5', fontWeight: '700' },
  detailTitle: { fontSize: 18, color: '#f5f5f5', fontWeight: '700', lineHeight: 24 },
  cardCopy: { fontSize: 14, color: '#b5b5b5', lineHeight: 20 },
  metricList: { gap: 0 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 10,
  },
  metricLabel: { fontSize: 13, color: '#8e8e93', flexShrink: 0 },
  metricValue: { fontSize: 14, color: '#e5e5e5', textAlign: 'right', flexShrink: 1 },
  purchaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  purchaseMerchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  purchaseDate: { fontSize: 13, color: '#888', marginTop: 2 },
  purchaseRight: { alignItems: 'flex-end' },
  purchaseAmount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },
  purchaseUnit: { fontSize: 12, color: '#888', marginTop: 2 },
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
