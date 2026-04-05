import { useEffect, useState } from 'react';
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

export default function RecurringItemScreen() {
  const { group_key: groupKey, title, insight_id: insightId = '' } = useLocalSearchParams();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!groupKey) {
        setError('Missing recurring item');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await api.get(`/recurring/item-history?group_key=${encodeURIComponent(groupKey)}`);
        if (!cancelled) {
          setHistory(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load recurring item history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupKey]);

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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen options={{ title: title || 'Recurring item' }} />
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
              <Text style={styles.cardTitle}>Timing</Text>
              <Text style={styles.rowText}>Last purchased: {history.last_purchased_at || '—'}</Text>
              <Text style={styles.rowText}>Next expected: {history.next_expected_date || '—'}</Text>
              <Text style={styles.rowText}>Merchants: {(history.merchants || []).join(', ') || '—'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent purchases</Text>
              {(history.purchases || []).map((purchase) => (
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
  cardTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  rowText: { fontSize: 14, color: '#e5e5e5' },
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
