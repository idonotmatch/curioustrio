import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { colors, radius } from '../theme/tokens';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return `${value}`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function sourceLabel(source) {
  if (source === 'email') return 'Gmail import';
  if (source === 'camera') return 'Receipt scan';
  if (source === 'manual') return 'Manual entry';
  return 'Expense';
}

function paymentLabel(expense = {}) {
  if (!expense.payment_method || expense.payment_method === 'unknown') return null;
  const card = expense.card_label || (expense.card_last4 ? `Card ending ${expense.card_last4}` : null);
  return [expense.payment_method, card].filter(Boolean).join(' · ');
}

function ExpenseComparison({ label, expense, accent = false }) {
  const details = [
    expense.category_name,
    paymentLabel(expense),
    expense.place_name || expense.address,
    Number(expense.item_count) > 0 ? `${expense.item_count} item${Number(expense.item_count) === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <View style={[styles.expenseBand, accent && styles.expenseBandAccent]}>
      <View style={styles.bandHeader}>
        <Text style={styles.bandLabel}>{label}</Text>
        <Text style={styles.source}>{sourceLabel(expense.source)}</Text>
      </View>
      <View style={styles.amountRow}>
        <View style={styles.merchantWrap}>
          <Text style={styles.merchant} numberOfLines={2}>{expense.merchant || expense.description || 'Untitled expense'}</Text>
          <Text style={styles.date}>{formatDate(expense.date)}</Text>
        </View>
        <Text style={styles.amount}>${Math.abs(Number(expense.amount || 0)).toFixed(2)}</Text>
      </View>
      {details.length ? <Text style={styles.details}>{details.join(' · ')}</Text> : null}
    </View>
  );
}

function hasValue(value, { unknown = false } = {}) {
  if (value == null || `${value}`.trim() === '') return false;
  return !unknown || value !== 'unknown';
}

function mergePreviewRows(existing = {}, imported = {}) {
  const location = existing.place_name || existing.address;
  const importedLocation = imported.place_name || imported.address;
  return [
    { label: 'Amount and date', value: `$${Math.abs(Number(existing.amount || 0)).toFixed(2)} · ${formatDate(existing.date)}`, source: 'Manual' },
    { label: 'Category', value: existing.category_name || 'Unassigned', source: 'Manual' },
    { label: 'Notes', value: existing.notes || imported.notes || 'None', source: existing.notes ? 'Manual' : imported.notes ? 'Import fills blank' : 'No change' },
    { label: 'Payment', value: paymentLabel(existing) || paymentLabel(imported) || 'Unknown', source: hasValue(existing.payment_method, { unknown: true }) ? 'Manual' : hasValue(imported.payment_method, { unknown: true }) ? 'Import fills blank' : 'No change' },
    { label: 'Location', value: location || importedLocation || 'None', source: location ? 'Manual' : importedLocation ? 'Import fills blank' : 'No change' },
    { label: 'Receipt items', value: Number(existing.item_count || 0) > 0 ? `${existing.item_count} manual items` : Number(imported.item_count || 0) > 0 ? `${imported.item_count} imported items` : 'None', source: Number(existing.item_count || 0) > 0 ? 'Manual' : Number(imported.item_count || 0) > 0 ? 'Import fills blank' : 'No change' },
    { label: 'Privacy and budget', value: `${existing.is_private ? 'Private' : 'Shared'} · ${existing.exclude_from_budget ? 'Track only' : 'Counts toward budget'}`, source: 'Manual' },
  ];
}

export default function DuplicateReviewScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const expenseId = firstParam(params.expense_id);
  const flagId = firstParam(params.flag_id);
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioning, setActioning] = useState('');
  const [mergeResult, setMergeResult] = useState(null);

  async function load() {
    if (!expenseId) {
      setError('This expense is no longer available.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setExpense(await api.get(`/expenses/${expenseId}`, { dedupe: false }));
    } catch (err) {
      setError(err?.message || 'Could not load this comparison.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [expenseId]);

  const flag = useMemo(() => {
    const flags = Array.isArray(expense?.duplicate_flags) ? expense.duplicate_flags : [];
    return flags.find((entry) => entry.id === flagId) || flags[0] || null;
  }, [expense, flagId]);
  const counterpart = flag?.duplicate_expense || null;
  const reasons = Array.isArray(flag?.match_reasons) ? flag.match_reasons : [];
  const canMergeIntoExisting = expense?.source === 'email'
    && counterpart?.source === 'manual'
    && flag?.can_replace_duplicate === true;

  async function resolve(action) {
    if (!flag?.id || actioning) return;
    setActioning(action);
    try {
      const result = await api.post(`/expenses/${expenseId}/duplicates/${flag.id}/resolve`, { action });
      await invalidateExpenseMutationCaches();
      if (action === 'merge_existing' && result?.merge_summary?.event_id) {
        setMergeResult(result);
        setActioning('');
        return;
      }
      router.replace('/review-queue');
    } catch (err) {
      Alert.alert('Could not save decision', err?.message || 'Please try again.');
      setActioning('');
    }
  }

  async function undoMerge() {
    const mergeEventId = mergeResult?.merge_summary?.event_id;
    if (!mergeEventId || actioning) return;
    setActioning('undo');
    try {
      await api.post(`/expenses/merges/${mergeEventId}/undo`, {});
      await invalidateExpenseMutationCaches();
      router.replace('/review-queue');
    } catch (err) {
      Alert.alert('Could not undo merge', err?.message || 'Please try again.');
      setActioning('');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={colors.text} />
        <Text style={styles.loadingText}>Loading comparison...</Text>
      </SafeAreaView>
    );
  }

  if (error || !expense || !flag || !counterpart) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Ionicons name="checkmark-circle-outline" size={30} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>{error ? 'Comparison unavailable' : 'Already resolved'}</Text>
        <Text style={styles.emptyBody}>{error || 'This match no longer needs a decision.'}</Text>
        {error ? (
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
    );
  }


  if (mergeResult) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Ionicons name="checkmark-circle-outline" size={36} color={colors.success} />
        <Text style={styles.emptyTitle}>Expenses merged</Text>
        <Text style={styles.emptyBody}>The manual expense stayed in place and blank details were filled from the import.</Text>
        <TouchableOpacity style={[styles.primaryButton, styles.resultButton]} onPress={() => router.replace({ pathname: '/expense/[id]', params: { id: mergeResult.surviving_expense_id } })}>
          <Text style={styles.primaryText}>View merged expense</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textButton} disabled={Boolean(actioning)} onPress={undoMerge}>
          {actioning === 'undo' ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.textButtonLabel}>Undo merge</Text>}
        </TouchableOpacity>
        <Text style={styles.undoNote}>Undo is available here for 10 minutes.</Text>
      </SafeAreaView>
    );
  }

  const newLabel = expense.source === 'email' ? 'This import' : 'New expense';
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Possible duplicate', headerBackTitle: 'Back' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Review match</Text>
          <Text style={styles.title}>Do these represent the same purchase?</Text>
          <Text style={styles.subtitle}>Nothing will be removed until you choose.</Text>
        </View>

        <ExpenseComparison label={newLabel} expense={expense} accent />
        <View style={styles.connector}>
          <View style={styles.connectorLine} />
          <View style={styles.connectorIcon}><Ionicons name="git-compare-outline" size={16} color={colors.warning} /></View>
          <View style={styles.connectorLine} />
        </View>
        <ExpenseComparison label="Existing expense" expense={counterpart} />

        {canMergeIntoExisting ? (
          <View style={styles.mergePreview}>
            <View style={styles.mergePreviewHeader}>
              <Ionicons name="layers-outline" size={18} color={colors.success} />
              <Text style={styles.mergePreviewTitle}>Merge preview</Text>
            </View>
            <Text style={styles.mergePreviewBody}>The manual expense survives. The import only fills fields that are blank.</Text>
            <View style={styles.mergeFieldList}>
              {mergePreviewRows(counterpart, expense).map((row) => (
                <View key={row.label} style={styles.mergeFieldRow}>
                  <View style={styles.mergeFieldCopy}>
                    <Text style={styles.mergeFieldLabel}>{row.label}</Text>
                    <Text style={styles.mergeFieldValue} numberOfLines={2}>{row.value}</Text>
                  </View>
                  <Text style={[styles.mergeFieldSource, row.source === 'Import fills blank' && styles.mergeFieldSourceImported]}>{row.source}</Text>
                </View>
              ))}
            </View>
            {Number(counterpart.item_count || 0) === 0 && Number(expense.item_count || 0) > 0 ? (
              <Text style={styles.mergePreviewAccent}>
                {expense.item_count} imported item{Number(expense.item_count) === 1 ? '' : 's'} will be added.
              </Text>
            ) : Number(counterpart.item_count || 0) > 0 && Number(expense.item_count || 0) > 0 ? (
              <Text style={styles.mergePreviewMuted}>The manual expense already has items, so its item list will stay unchanged.</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.evidence}>
          <Text style={styles.evidenceTitle}>Why it was flagged</Text>
          <View style={styles.reasonWrap}>
            {(reasons.length ? reasons : [`${flag.confidence || 'Possible'} match`]).map((reason) => (
              <View key={reason} style={styles.reasonChip}>
                <Ionicons name="checkmark" size={13} color={colors.warning} />
                <Text style={styles.reasonText}>{reason}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryButton}
            disabled={Boolean(actioning)}
            onPress={() => resolve(canMergeIntoExisting ? 'merge_existing' : 'keep_existing')}
          >
            {actioning === (canMergeIntoExisting ? 'merge_existing' : 'keep_existing') ? <ActivityIndicator color={colors.textInverse} /> : (
              <>
                <Ionicons name={canMergeIntoExisting ? 'layers-outline' : 'archive-outline'} size={18} color={colors.textInverse} />
                <Text style={styles.primaryText}>{canMergeIntoExisting ? 'Merge into existing' : 'Keep existing'}</Text>
              </>
            )}
          </TouchableOpacity>
          {canMergeIntoExisting ? (
            <TouchableOpacity style={styles.secondaryButton} disabled={Boolean(actioning)} onPress={() => resolve('keep_existing')}>
              {actioning === 'keep_existing' ? <ActivityIndicator color={colors.text} /> : (
                <>
                  <Ionicons name="archive-outline" size={18} color={colors.text} />
                  <Text style={styles.secondaryText}>Keep existing only</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
          {flag.can_replace_duplicate ? (
            <TouchableOpacity style={styles.secondaryButton} disabled={Boolean(actioning)} onPress={() => resolve('keep_new')}>
              {actioning === 'keep_new' ? <ActivityIndicator color={colors.text} /> : (
                <>
                  <Ionicons name="swap-horizontal-outline" size={18} color={colors.text} />
                  <Text style={styles.secondaryText}>Keep {expense.source === 'email' ? 'this import' : 'new expense'}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.textButton} disabled={Boolean(actioning)} onPress={() => resolve('keep_both')}>
            {actioning === 'keep_both' ? <ActivityIndicator color={colors.textMuted} /> : <Text style={styles.textButtonLabel}>These are different. Keep both</Text>}
          </TouchableOpacity>
          {!flag.can_replace_duplicate ? (
            <Text style={styles.ownershipNote}>The existing expense belongs to another household member, so it cannot be removed here.</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  content: { paddingBottom: 36 },
  loadingText: { color: colors.textMuted, marginTop: 12, fontSize: 14 },
  intro: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  eyebrow: { color: colors.warning, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '700', marginTop: 7 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  expenseBand: { paddingHorizontal: 20, paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface },
  expenseBandAccent: { borderLeftWidth: 3, borderLeftColor: colors.warning, backgroundColor: colors.surfaceRaised },
  bandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bandLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  source: { color: colors.textSubtle, fontSize: 12 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginTop: 14 },
  merchantWrap: { flex: 1, minWidth: 0 },
  merchant: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '600' },
  date: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  amount: { color: colors.text, fontSize: 24, lineHeight: 29, fontWeight: '700' },
  details: { color: colors.textSubtle, fontSize: 12, lineHeight: 18, marginTop: 13 },
  connector: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, height: 44 },
  connectorLine: { flex: 1, height: 1, backgroundColor: colors.border },
  connectorIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.warningMuted, borderWidth: 1, borderColor: colors.warningBorder, marginHorizontal: 10 },
  evidence: { paddingHorizontal: 20, paddingVertical: 22 },
  evidenceTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 11 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radius.xs, backgroundColor: colors.warningMuted, borderWidth: 1, borderColor: colors.warningBorder },
  reasonText: { color: colors.textMuted, fontSize: 12 },
  mergePreview: { marginHorizontal: 20, marginBottom: 22, padding: 14, borderRadius: radius.sm, backgroundColor: colors.successMuted, borderWidth: 1, borderColor: colors.successBorder },
  mergePreviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mergePreviewTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  mergePreviewBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 9 },
  mergePreviewAccent: { color: colors.success, fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 8 },
  mergePreviewMuted: { color: colors.textSubtle, fontSize: 12, lineHeight: 18, marginTop: 8 },
  mergeFieldList: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.successBorder },
  mergeFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.successBorder },
  mergeFieldCopy: { flex: 1, minWidth: 0 },
  mergeFieldLabel: { color: colors.textSubtle, fontSize: 11, marginBottom: 2 },
  mergeFieldValue: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  mergeFieldSource: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', maxWidth: 92, textAlign: 'right' },
  mergeFieldSourceImported: { color: colors.success },
  actions: { paddingHorizontal: 20, gap: 10 },
  primaryButton: { minHeight: 50, borderRadius: radius.sm, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  secondaryButton: { minHeight: 50, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  textButtonLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  ownershipNote: { color: colors.textSubtle, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 13 },
  emptyBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7 },
  retryButton: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  retryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  resultButton: { alignSelf: 'stretch', marginTop: 22 },
  undoNote: { color: colors.textDisabled, fontSize: 12, marginTop: 4 },
});
