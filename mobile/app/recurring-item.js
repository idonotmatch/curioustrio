import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { refreshInsightsAfterFeedback } from '../services/insightFeedbackEffects';
import { loadWithCache } from '../services/cache';
import { consumeNavigationPayload } from '../services/navigationPayloadStore';
import { openExpenseDetail } from '../services/openExpenseDetail';
import { getItemInsightEvidence, getItemInsightSummary } from '../services/itemInsightPresentation';
import { SecondaryButton } from '../components/ui/Buttons';
import { colors } from '../theme/tokens';

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

function formatPriceBasis(unit) {
  const labels = {
    fl_oz: 'fl oz',
    ea: 'item',
    ct: 'item',
  };
  return labels[unit] || unit || 'item';
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

export default function RecurringItemScreen() {
  const router = useRouter();
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
  const [planningPreference, setPlanningPreference] = useState(preloadHistory?.planning_preference || null);
  const [planningSaving, setPlanningSaving] = useState(false);
  const [targetPrice, setTargetPrice] = useState(preloadHistory?.planning_preference?.target_price == null
    ? ''
    : `${preloadHistory.planning_preference.target_price}`);
  const [planningStatus, setPlanningStatus] = useState('');
  const metadata = useMemo(
    () => navPayload?.metadata || parseMetadata(Array.isArray(metadataParam) ? metadataParam[0] : metadataParam),
    [metadataParam, navPayload]
  );
  const summary = useMemo(
    () => getItemInsightSummary(Array.isArray(insightType) ? insightType[0] : insightType, metadata, history, Array.isArray(body) ? body[0] : body),
    [body, history, insightType, metadata]
  );
  const evidence = useMemo(() => getItemInsightEvidence(metadata, history), [history, metadata]);
  const merchantPriceHistory = Array.isArray(history?.merchant_price_history) ? history.merchant_price_history : [];
  const purchaseHistory = Array.isArray(history?.purchases) ? history.purchases : [];
  const latestPurchase = purchaseHistory[purchaseHistory.length - 1] || null;
  function handleOpenExpense(expense) {
    openExpenseDetail(router, expense);
  }

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
            setPlanningPreference(data?.planning_preference || null);
            setTargetPrice(data?.planning_preference?.target_price == null ? '' : `${data.planning_preference.target_price}`);
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

  async function savePlanningPreference(patch = {}, successMessage = '') {
    if (!groupKey || planningSaving) return;
    try {
      setPlanningSaving(true);
      const result = await api.put('/recurring/item-preferences', {
        group_key: `${groupKey}`,
        state: patch.state || planningPreference?.state || 'watching',
        remind_on: patch.remind_on === undefined ? planningPreference?.remind_on || null : patch.remind_on,
        target_price: patch.target_price === undefined ? planningPreference?.target_price ?? null : patch.target_price,
        notes: planningPreference?.notes || null,
      });
      setPlanningPreference(result);
      setTargetPrice(result?.target_price == null ? '' : `${result.target_price}`);
      setPlanningStatus(successMessage);
    } catch (err) {
      Alert.alert('Could not update item plan', err?.message || 'Try again in a moment.');
    } finally {
      setPlanningSaving(false);
    }
  }

  function remindInSevenDays() {
    const reminder = new Date();
    reminder.setDate(reminder.getDate() + 7);
    savePlanningPreference({
      state: planningPreference?.state === 'suppressed' ? 'watching' : planningPreference?.state || 'watching',
      remind_on: reminder.toISOString().slice(0, 10),
    }, 'Reminder set for 7 days from now.');
  }

  function suppressRecurringSignal() {
    Alert.alert(
      'Stop recurring suggestions?',
      'Adlo will keep the purchase history but stop predicting when this item is due.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop suggestions',
          style: 'destructive',
          onPress: () => savePlanningPreference({ state: 'suppressed', remind_on: null }, 'Recurring suggestions stopped.'),
        },
      ]
    );
  }

  async function submitFeedback(eventType) {
    if (!insightId || !eventType || feedbackStatus === eventType) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: eventType,
          metadata: {
            surface: 'recurring_item_detail',
            type: `${insightType || ''}` || null,
            insight_type: `${insightType || ''}` || null,
            entity_type: 'item',
            entity_id: `${groupKey || ''}` || null,
            group_key: `${groupKey || ''}`,
          },
        }],
      });
      await refreshInsightsAfterFeedback();
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
            type: `${insightType || ''}` || null,
            insight_type: `${insightType || ''}` || null,
            entity_type: 'item',
            entity_id: `${groupKey || ''}` || null,
            group_key: `${groupKey || ''}`,
            reason: feedbackReason,
            note: feedbackNote.trim() || null,
          },
        }],
      });
      await refreshInsightsAfterFeedback();
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
            <ActivityIndicator color={colors.text} />
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
                {history.median_unit_price != null
                  ? ` · ${formatCurrency(history.median_unit_price)} / ${formatPriceBasis(history.price_basis_unit)}`
                  : ''}
              </Text>
              <View style={styles.evidenceLine}>
                <Ionicons name="shield-checkmark-outline" size={15} color={colors.success} />
                <View style={styles.evidenceCopy}>
                  <Text style={styles.evidenceLabel}>{evidence.label}</Text>
                  <Text style={styles.evidenceDetail}>{evidence.detail}</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>What changed</Text>
              <Text style={styles.detailTitle}>{summary.whatChanged}</Text>
              <Text style={styles.cardCopy}>{summary.whyItMatters}</Text>
            </View>

            <View style={styles.planningSection}>
              <Text style={styles.cardEyebrow}>Plan</Text>
              <Text style={styles.cardTitle}>Turn this signal into a next step</Text>
              <View style={styles.planningActions}>
                <TouchableOpacity
                  style={[styles.planningAction, planningPreference?.state === 'needed' && styles.planningActionActive]}
                  disabled={planningSaving}
                  onPress={() => savePlanningPreference(
                    { state: planningPreference?.state === 'needed' ? 'watching' : 'needed' },
                    planningPreference?.state === 'needed' ? 'Removed from your next shop.' : 'Added to your next shop.'
                  )}
                  accessibilityRole="button"
                  accessibilityLabel={planningPreference?.state === 'needed' ? 'Remove from next shop' : 'Add to next shop'}
                >
                  <Ionicons
                    name={planningPreference?.state === 'needed' ? 'checkmark-circle' : 'cart-outline'}
                    size={19}
                    color={planningPreference?.state === 'needed' ? colors.textInverse : colors.text}
                  />
                  <Text style={[styles.planningActionText, planningPreference?.state === 'needed' && styles.planningActionTextActive]}>
                    {planningPreference?.state === 'needed' ? 'On next shop' : 'Add to next shop'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.planningAction}
                  disabled={planningSaving}
                  onPress={remindInSevenDays}
                  accessibilityRole="button"
                  accessibilityLabel="Remind me about this item in seven days"
                >
                  <Ionicons name="notifications-outline" size={19} color={colors.text} />
                  <Text style={styles.planningActionText}>Remind in 7 days</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.targetPriceRow}>
                <View style={styles.targetPriceCopy}>
                  <Text style={styles.targetPriceLabel}>Target price</Text>
                  <Text style={styles.targetPriceHint}>Use the same basis as the history above.</Text>
                </View>
                <TextInput
                  value={targetPrice}
                  onChangeText={setTargetPrice}
                  onBlur={() => {
                    const value = Number(targetPrice);
                    if (targetPrice && Number.isFinite(value) && value > 0 && value !== Number(planningPreference?.target_price)) {
                      savePlanningPreference({ target_price: value }, 'Target price saved.');
                    }
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textDisabled}
                  style={styles.targetPriceInput}
                  accessibilityLabel="Target price"
                />
              </View>
              <View style={styles.planningFooter}>
                <TouchableOpacity onPress={() => router.push('/shopping-list')} accessibilityRole="button">
                  <Text style={styles.planningLink}>View next shop</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={suppressRecurringSignal} disabled={planningSaving} accessibilityRole="button">
                  <Text style={styles.planningDanger}>Stop recurring suggestions</Text>
                </TouchableOpacity>
              </View>
              {planningStatus ? <Text style={styles.planningStatus}>{planningStatus}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Next step</Text>
              <Text style={styles.cardTitle}>What to do next</Text>
              <Text style={styles.cardCopy}>{summary.nextStep}</Text>
              {latestPurchase?.id || latestPurchase?.expense_id ? (
                <SecondaryButton
                  title="Review latest purchase"
                  icon="receipt-outline"
                  onPress={() => handleOpenExpense(latestPurchase)}
                  style={styles.reviewButton}
                />
              ) : null}
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
                <Text style={styles.cardCopy}>Comparisons use repeat observations at each merchant. One-off prices are not treated as a recommendation.</Text>
                {merchantPriceHistory.map((entry) => (
                  <View key={`${entry.merchant}:${entry.occurrence_count}`} style={styles.purchaseRow}>
                    <View style={styles.purchaseLeft}>
                      <Text style={styles.purchaseMerchant}>{entry.merchant || 'Unknown merchant'}</Text>
                      <Text style={styles.purchaseDate}>
                        {entry.occurrence_count} purchases
                        {entry.merchant === metadata.cheaper_merchant ? ' · Lower observed' : ''}
                        {entry.merchant === metadata.pricier_merchant ? ' · Higher observed' : ''}
                      </Text>
                    </View>
                    <View style={styles.purchaseRight}>
                      <Text style={styles.purchaseAmount}>{formatCurrency(entry.median_amount)}</Text>
                      {entry.median_unit_price != null ? (
                        <Text style={styles.purchaseUnit}>
                          {formatCurrency(entry.median_unit_price)} / {formatPriceBasis(entry.price_basis_unit || history.price_basis_unit)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Supporting activity</Text>
              <Text style={styles.cardTitle}>Recent purchases</Text>
              <Text style={styles.cardCopy}>Open a purchase to correct its item match, amount, merchant, or date. Changes will feed the next insight refresh.</Text>
              {purchaseHistory.map((purchase, index) => {
                const purchaseId = purchase.id || purchase.expense_id || null;
                const expenseItemId = purchase.expense_item_id || null;
                const purchaseKey = expenseItemId
                  ? `expense-item:${expenseItemId}`
                  : `${purchaseId || purchase.date}:${purchase.merchant}:${purchase.item_amount}:${purchase.estimated_unit_price ?? 'na'}:${index}`;
                return (
                <TouchableOpacity
                  key={purchaseKey}
                  style={styles.purchaseRow}
                  activeOpacity={purchaseId ? 0.82 : 1}
                  disabled={!purchaseId}
                  onPress={() => handleOpenExpense(purchase)}
                >
                  <View style={styles.purchaseLeft}>
                    <Text style={styles.purchaseMerchant}>{purchase.merchant || 'Unknown merchant'}</Text>
                    <Text style={styles.purchaseDate}>{purchase.date}</Text>
                  </View>
                  <View style={styles.purchaseRight}>
                    <View style={styles.purchaseAmountRow}>
                      <Text style={styles.purchaseAmount}>{formatCurrency(purchase.item_amount ?? purchase.amount)}</Text>
                      {purchaseId ? <Ionicons name="chevron-forward" size={15} color={colors.textDisabled} /> : null}
                    </View>
                    {purchase.estimated_unit_price != null ? (
                      <Text style={styles.purchaseUnit}>
                        {formatCurrency(purchase.estimated_unit_price)} / {formatPriceBasis(purchase.normalized_total_size_unit || history.price_basis_unit)}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
                );
              })}
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
              placeholderTextColor={colors.textDisabled}
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.textSubtle, fontSize: 15 },
  hero: { gap: 6, marginBottom: 8 },
  itemName: { fontSize: 30, color: colors.text, fontWeight: '600', letterSpacing: 0 },
  subtle: { fontSize: 14, color: colors.textSubtle },
  heroStat: { fontSize: 14, color: colors.textMuted },
  evidenceLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 8,
  },
  evidenceCopy: { flex: 1, gap: 2 },
  evidenceLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  evidenceDetail: { fontSize: 12, color: colors.textSubtle, lineHeight: 17 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  planningSection: {
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    paddingTop: 16,
    gap: 12,
  },
  planningActions: { flexDirection: 'row', gap: 8 },
  planningAction: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  planningActionActive: { backgroundColor: colors.text, borderColor: colors.text },
  planningActionText: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  planningActionTextActive: { color: colors.textInverse },
  targetPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  targetPriceCopy: { flex: 1, gap: 2 },
  targetPriceLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  targetPriceHint: { color: colors.textSubtle, fontSize: 11 },
  targetPriceInput: {
    width: 88,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
    paddingHorizontal: 10,
  },
  planningFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  planningLink: { color: colors.info, fontSize: 13, fontWeight: '600' },
  planningDanger: { color: colors.danger, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  planningStatus: { color: colors.success, fontSize: 12 },
  cardEyebrow: { fontSize: 11, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },
  cardTitle: { fontSize: 16, color: colors.text, fontWeight: '700' },
  detailTitle: { fontSize: 18, color: colors.text, fontWeight: '700', lineHeight: 24 },
  cardCopy: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  reviewButton: { alignSelf: 'stretch', marginTop: 2 },
  metricList: { gap: 0 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 10,
  },
  metricLabel: { fontSize: 13, color: colors.textSubtle, flexShrink: 0 },
  metricValue: { fontSize: 14, color: colors.text, textAlign: 'right', flexShrink: 1 },
  purchaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: 12,
  },
  purchaseLeft: { flex: 1, minWidth: 0 },
  purchaseMerchant: { fontSize: 15, color: colors.text, fontWeight: '500' },
  purchaseDate: { fontSize: 13, color: colors.textSubtle, marginTop: 2 },
  purchaseRight: { alignItems: 'flex-end' },
  purchaseAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  purchaseAmount: { fontSize: 15, color: colors.text, fontWeight: '600' },
  purchaseUnit: { fontSize: 12, color: colors.textSubtle, marginTop: 2 },
  feedbackRow: { flexDirection: 'row', gap: 10 },
  feedbackCopy: { fontSize: 13, color: colors.textSubtle, lineHeight: 18 },
  feedbackButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 12,
    alignItems: 'center',
  },
  feedbackButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  feedbackButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  feedbackButtonTextActive: {
    color: colors.textInverse,
  },
  feedbackNote: {
    fontSize: 12,
    color: colors.success,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 14,
  },
  modalTitle: {
    fontSize: 20,
    color: colors.text,
    fontWeight: '600',
  },
  modalCopy: {
    fontSize: 14,
    color: colors.textMuted,
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
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfacePressed,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reasonChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  reasonChipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  reasonChipTextActive: {
    color: colors.textInverse,
  },
  noteInput: {
    minHeight: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
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
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  modalPrimaryButton: {
    borderRadius: 12,
    backgroundColor: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.4,
  },
  modalPrimaryText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});
