import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../services/api';
import { getInsightActionDescriptor, getPrimaryActionForInsight } from '../services/insightPresentation';

const FEEDBACK_REASONS = [
  { key: 'wrong_timing', label: 'Wrong timing' },
  { key: 'not_relevant', label: 'Not relevant' },
  { key: 'not_accurate', label: 'Not accurate' },
  { key: 'already_knew', label: 'I already knew this' },
];

function formatLabel(value) {
  return `${value || ''}`
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function firstParam(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function formatValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `${value}`;
    return `${Number(value).toFixed(1)}`;
  }
  return `${value}`;
}

function metadataHighlights(metadata = {}) {
  const rows = [
    ['Maturity', metadata.maturity],
    ['Confidence', metadata.confidence],
    ['Scope', metadata.scope],
    ['Month', metadata.month],
    ['Category', metadata.category_name],
    ['Merchant', metadata.merchant_name],
    ['Current spend', metadata.current_spend_to_date ?? metadata.current_spend],
    ['Previous spend', metadata.previous_spend],
    ['Share of spend', metadata.share_of_spend != null ? `${metadata.share_of_spend}%` : null],
    ['Expense count', metadata.expense_count],
    ['Active days', metadata.active_day_count],
    ['Uncategorized', metadata.uncategorized_count],
    ['Combined scopes', Array.isArray(metadata.consolidated_scopes) ? metadata.consolidated_scopes.map(formatLabel).join(' + ') : null],
  ];

  return rows
    .map(([label, value]) => ({ label, value: formatValue(value) }))
    .filter((row) => row.value != null)
    .slice(0, 8);
}

function contextCopy(type) {
  if (`${type}`.startsWith('early_')) {
    return 'This is an early read. It is meant to be useful before there is enough history for a mature trend.';
  }
  if (`${type}`.startsWith('developing_')) {
    return 'This is a developing read from short-term activity. It should get more tailored as the pattern either repeats or fades.';
  }
  return 'This card is based on the current insight signal and your recent activity.';
}

function consolidatedCopy(metadata = {}) {
  if (metadata.scope_relationship !== 'personal_household_overlap') return null;
  const foldedCount = Array.isArray(metadata.related_insight_ids) ? metadata.related_insight_ids.length : 0;
  if (foldedCount > 0) {
    return 'A similar personal or household card was folded into this one, so you can review the shared story once.';
  }
  return 'This card combines personal and household signals that were pointing at the same story.';
}

function consolidatedRows(metadata = {}) {
  const rows = Array.isArray(metadata.consolidated_from) ? metadata.consolidated_from : [];
  return rows
    .map((row) => ({
      id: row.id || `${row.scope || 'scope'}:${row.type || 'insight'}`,
      scope: row.scope ? formatLabel(row.scope) : 'Unknown',
      type: row.type ? formatLabel(row.type) : 'Insight',
      maturity: row.maturity ? formatLabel(row.maturity) : null,
      severity: row.severity ? formatLabel(row.severity) : null,
    }))
    .slice(0, 4);
}

export default function InsightDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insightId = firstParam(params.insight_id);
  const insightType = firstParam(params.insight_type);
  const title = firstParam(params.title, 'Insight detail');
  const body = firstParam(params.body);
  const severity = firstParam(params.severity, 'low');
  const entityType = firstParam(params.entity_type);
  const entityId = firstParam(params.entity_id);
  const metadataParam = firstParam(params.metadata);
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');

  const metadata = useMemo(() => {
    if (!metadataParam) return {};
    try {
      return JSON.parse(`${metadataParam}`);
    } catch {
      return {};
    }
  }, [metadataParam]);

  const insight = useMemo(() => ({
    id: `${insightId}`,
    type: `${insightType}`,
    title: `${title}`,
    body: `${body}`,
    severity: `${severity}`,
    entity_type: `${entityType}`,
    entity_id: `${entityId}`,
    metadata,
  }), [insightId, insightType, title, body, severity, entityType, entityId, metadata]);

  const descriptor = getInsightActionDescriptor(insight);
  const primaryAction = getPrimaryActionForInsight({
    insightType: `${insightType}`,
    scope: metadata.scope || 'personal',
    month: metadata.month || '',
    categoryKey: metadata.category_key || '',
    trend: null,
  });
  const highlights = metadataHighlights(metadata);
  const consolidationNote = consolidatedCopy(metadata);
  const consolidationRows = consolidatedRows(metadata);

  async function submitFeedback(eventType) {
    if (!insightId || !eventType || feedbackStatus === eventType) return;
    try {
      await api.post('/insights/events', {
        events: [{
          insight_id: `${insightId}`,
          event_type: eventType,
          metadata: {
            surface: 'insight_detail',
            insight_type: `${insightType}`,
            type: `${insightType}`,
            maturity: metadata.maturity || null,
            confidence: metadata.confidence || null,
            scope: metadata.scope || null,
            entity_type: `${entityType}` || null,
            entity_id: `${entityId}` || null,
            category_key: metadata.category_key || null,
            merchant_key: metadata.merchant_key || null,
            scope_relationship: metadata.scope_relationship || null,
            consolidated_scopes: metadata.consolidated_scopes || null,
            related_insight_ids: metadata.related_insight_ids || null,
          },
        }],
      });
      setFeedbackStatus(eventType);
    } catch {
      // Non-fatal
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
            surface: 'insight_detail',
            insight_type: `${insightType}`,
            type: `${insightType}`,
            maturity: metadata.maturity || null,
            confidence: metadata.confidence || null,
            scope: metadata.scope || null,
            entity_type: `${entityType}` || null,
            entity_id: `${entityId}` || null,
            category_key: metadata.category_key || null,
            merchant_key: metadata.merchant_key || null,
            scope_relationship: metadata.scope_relationship || null,
            consolidated_scopes: metadata.consolidated_scopes || null,
            related_insight_ids: metadata.related_insight_ids || null,
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
      // Non-fatal
    }
  }

  function openPrimaryAction() {
    if (primaryAction?.route) router.push(primaryAction.route);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Insight detail' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.chipRow}>
            <Text style={styles.scopeChip}>{metadata.scope === 'household' ? 'Household' : 'You'}</Text>
            <Text style={styles.tierChip}>{formatLabel(metadata.maturity || 'Insight')}</Text>
            {metadata.scope_relationship === 'personal_household_overlap' ? (
              <Text style={styles.combinedChip}>Combined</Text>
            ) : null}
          </View>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroCopy}>{body}</Text>
          <Text style={styles.heroContext}>{contextCopy(insightType)}</Text>
        </View>

        {consolidationNote ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Combined read</Text>
            <Text style={styles.cardCopy}>{consolidationNote}</Text>
            {consolidationRows.length > 0 ? (
              <View style={styles.foldedList}>
                {consolidationRows.map((row) => (
                  <View key={row.id} style={styles.foldedRow}>
                    <View style={styles.foldedText}>
                      <Text style={styles.foldedScope}>{row.scope}</Text>
                      <Text style={styles.foldedType}>{row.type}</Text>
                    </View>
                    <Text style={styles.foldedMeta}>
                      {[row.maturity, row.severity].filter(Boolean).join(' / ')}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{primaryAction?.title || descriptor.label}</Text>
          <Text style={styles.cardCopy}>{primaryAction?.body || descriptor.reason}</Text>
          {primaryAction?.route && primaryAction?.cta ? (
            <TouchableOpacity style={styles.primaryButton} onPress={openPrimaryAction}>
              <Text style={styles.primaryButtonText}>{primaryAction.cta}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {highlights.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Signal details</Text>
            {highlights.map((row) => (
              <View key={row.label} style={styles.metricRow}>
                <Text style={styles.metricLabel}>{row.label}</Text>
                <Text style={styles.metricValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Was this useful?</Text>
          <Text style={styles.cardCopy}>Your feedback helps Adlo learn whether early signals are useful now or should wait until they are more specific.</Text>
          <View style={styles.feedbackRow}>
            <TouchableOpacity
              style={[styles.feedbackButton, feedbackStatus === 'helpful' && styles.feedbackButtonActive]}
              onPress={() => submitFeedback('helpful')}
            >
              <Text style={[styles.feedbackButtonText, feedbackStatus === 'helpful' && styles.feedbackButtonTextActive]}>Helpful</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.feedbackButton, feedbackStatus === 'not_helpful' && styles.feedbackButtonActive]}
              onPress={() => setShowFeedbackSheet(true)}
            >
              <Text style={[styles.feedbackButtonText, feedbackStatus === 'not_helpful' && styles.feedbackButtonTextActive]}>Not helpful</Text>
            </TouchableOpacity>
          </View>
          {feedbackStatus ? (
            <Text style={styles.feedbackNote}>Thanks. We will use this to tune future insight timing.</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={showFeedbackSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFeedbackSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>What felt off?</Text>
            <View style={styles.reasonGrid}>
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
              style={styles.noteInput}
              placeholder="Optional note"
              placeholderTextColor="#666"
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setShowFeedbackSheet(false)}>
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
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  hero: {
    backgroundColor: '#141414',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 18,
    gap: 12,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  scopeChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5f7ed',
    color: '#14532d',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  tierChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    color: '#78350f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  combinedChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    color: '#1e3a8a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  heroTitle: { color: '#f5f5f5', fontSize: 24, fontWeight: '800', lineHeight: 30 },
  heroCopy: { color: '#d4d4d4', fontSize: 15, lineHeight: 22 },
  heroContext: { color: '#9d9d9d', fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#242424',
    padding: 16,
    gap: 12,
  },
  cardTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  cardCopy: { color: '#b8b8b8', fontSize: 13, lineHeight: 19 },
  foldedList: { gap: 8 },
  foldedRow: {
    borderTopWidth: 1,
    borderTopColor: '#242424',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  foldedText: { flex: 1 },
  foldedScope: { color: '#f5f5f5', fontSize: 13, fontWeight: '700' },
  foldedType: { color: '#8a8a8a', fontSize: 12, marginTop: 2 },
  foldedMeta: { color: '#b8b8b8', fontSize: 12, textAlign: 'right', flexShrink: 0 },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#242424',
    paddingTop: 10,
  },
  metricLabel: { color: '#8a8a8a', fontSize: 12, flex: 1 },
  metricValue: { color: '#f5f5f5', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
  feedbackRow: { flexDirection: 'row', gap: 10 },
  feedbackButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingVertical: 11,
    alignItems: 'center',
  },
  feedbackButtonActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  feedbackButtonText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  feedbackButtonTextActive: { color: '#0a0a0a' },
  feedbackNote: { color: '#86efac', fontSize: 12, lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#111',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
    padding: 20,
    gap: 14,
  },
  modalTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '800' },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reasonChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  reasonChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  reasonChipText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  reasonChipTextActive: { color: '#0a0a0a' },
  noteInput: {
    minHeight: 84,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    color: '#f5f5f5',
    padding: 12,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalSecondaryText: { color: '#d4d4d4', fontSize: 13, fontWeight: '700' },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalPrimaryButtonDisabled: { opacity: 0.4 },
  modalPrimaryText: { color: '#0a0a0a', fontSize: 13, fontWeight: '800' },
});
