import { View, Text, FlatList, StyleSheet, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionNotice } from '../components/ActionNotice';
import { DismissReasonSheet } from '../components/DismissReasonSheet';
import { SkippedImportsList } from '../components/SkippedImportsList';
import { usePendingExpenses, removePendingExpense, restorePendingExpense } from '../hooks/usePendingExpenses';
import { ReviewQueueItem, reviewQueueGroup } from '../components/ReviewQueueItem';
import { api } from '../services/api';
import { patchExpenseInCachedLists, removeExpenseFromCachedLists, removeExpenseSnapshot, saveExpenseSnapshot } from '../services/expenseLocalStore';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { colors } from '../theme/tokens';

function summarizeReviewModes(expenses = []) {
  const counts = { quickCheck: 0, itemsFirst: 0, review: 0 };
  for (const expense of expenses) {
    const mode = expense?.gmail_review_hint?.review_mode;
    if (mode === 'quick_check') counts.quickCheck += 1;
    else if (mode === 'items_first') counts.itemsFirst += 1;
    else counts.review += 1;
  }
  return counts;
}

function buildQueueRows(expenses = []) {
  const groups = new Map();
  for (const expense of expenses) {
    const group = reviewQueueGroup(expense);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, rows: [] });
    groups.get(group.key).rows.push(expense);
  }
  return [...groups.values()]
    .sort((a, b) => a.priority - b.priority)
    .flatMap((group) => [
      { type: 'group', key: `group:${group.key}`, title: group.title, count: group.rows.length },
      ...group.rows.map((expense) => ({ type: 'expense', key: expense.id, expense })),
    ]);
}

function LoadingRows() {
  return (
    <View style={styles.loadingRows}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.loadingRow}>
          <View style={styles.loadingLineWide} />
          <View style={styles.loadingLine} />
          <View style={styles.loadingLineShort} />
        </View>
      ))}
    </View>
  );
}

export default function ReviewQueueScreen() {
  const router = useRouter();
  const { expenses, loading, loadingMore, hasMore, error, refresh, loadMore, isUsingMockData, resolveMockExpense } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);
  const [reviewTab, setReviewTab] = useState('pending');
  const [notice, setNotice] = useState('');
  const [dismissingId, setDismissingId] = useState(null);
  const [actioningIds, setActioningIds] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchActioning, setBatchActioning] = useState('');
  const actioningIdsRef = useRef(new Set());
  const reviewModeCounts = summarizeReviewModes(displayExpenses);
  const queueRows = buildQueueRows(displayExpenses);
  const totalActions = displayExpenses.length;
  const hasSecondarySummary = reviewModeCounts.quickCheck > 0 || reviewModeCounts.itemsFirst > 0;
  const selectedExpenses = displayExpenses.filter((expense) => selectedIds.has(expense.id));
  const selectedHasItemsFirst = selectedExpenses.some((expense) => expense?.gmail_review_hint?.review_mode === 'items_first');
  const selectedHasDuplicate = selectedExpenses.some((expense) => Array.isArray(expense?.duplicate_flags) && expense.duplicate_flags.length > 0);
  const canBatchApprove = selectedExpenses.length > 0 && !selectedHasItemsFirst && !selectedHasDuplicate;

  function openReviewEntry(entry) {
    const duplicateFlag = Array.isArray(entry?.duplicate_flags) ? entry.duplicate_flags[0] : null;
    if (duplicateFlag?.id) {
      router.push({
        pathname: '/duplicate-review',
        params: { expense_id: entry.id, flag_id: duplicateFlag.id },
      });
      return;
    }
    router.push({
      pathname: '/expense/[id]',
      params: { id: entry.id, expense: JSON.stringify(entry) },
    });
  }

  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);
  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => displayExpenses.some((expense) => expense.id === id))));
  }, [displayExpenses]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  const remove = (id) => {
    setDisplayExpenses((prev) => prev.filter((expense) => expense.id !== id));
    removePendingExpense(id);
  };

  const restore = (expense) => {
    if (!expense?.id) return;
    setDisplayExpenses((prev) => (
      prev.some((item) => item.id === expense.id) ? prev : [expense, ...prev]
    ));
    restorePendingExpense(expense);
  };

  const setActioning = (id, value) => {
    if (!id) return;
    const next = new Set(actioningIdsRef.current);
    if (value) next.add(id);
    else next.delete(id);
    actioningIdsRef.current = next;
    setActioningIds(next);
  };

  function requestDismiss(id) {
    setDismissingId(id);
  }

  function toggleSelection(expense) {
    if (!expense?.id || batchActioning) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(expense.id)) next.delete(expense.id);
      else next.add(expense.id);
      return next;
    });
  }

  function leaveSelectionMode() {
    if (batchActioning) return;
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function runBatch(action, dismissalReason = null) {
    if (!selectedExpenses.length || batchActioning) return;
    if (action === 'approve' && !canBatchApprove) return;
    const selectedSnapshot = [...selectedExpenses];
    const ids = selectedSnapshot.map((expense) => expense.id);
    setBatchActioning(action);
    ids.forEach(remove);
    setDismissingId(null);
    try {
      if (isUsingMockData) {
        ids.forEach(resolveMockExpense);
      } else {
        const result = await api.post('/expenses/pending/batch', {
          action,
          ids,
          ...(action === 'approve' ? {
            review_contexts: Object.fromEntries(selectedSnapshot.map((expense) => [
              expense.id,
              expense?.gmail_review_hint?.review_mode === 'quick_check' ? 'quick_check' : 'full_review',
            ])),
          } : {}),
          ...(action === 'dismiss' ? { dismissal_reason: dismissalReason } : {}),
        });
        const failed = new Set(result?.failed_ids || []);
        selectedSnapshot.filter((expense) => failed.has(expense.id)).forEach(restore);
        if (action === 'dismiss') {
          Promise.all((result?.processed_ids || []).map((id) => Promise.all([
            removeExpenseFromCachedLists(id),
            removeExpenseSnapshot(id),
          ]))).catch(() => {});
        }
        invalidateExpenseMutationCaches().catch(() => {});
        if (failed.size) setNotice(`${result?.processed_count || 0} saved; ${failed.size} still need review`);
        else setNotice(action === 'approve' ? `${ids.length} approved` : `${ids.length} dismissed`);
      }
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch {
      selectedSnapshot.forEach(restore);
      setNotice(`Could not ${action === 'approve' ? 'approve' : 'dismiss'} selection. Try again.`);
    } finally {
      setBatchActioning('');
    }
  }

  async function dismiss(id, dismissalReason) {
    if (actioningIdsRef.current.has(id)) return;
    const dismissed = displayExpenses.find((entry) => entry.id === id);
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      setDismissingId(null);
      setNotice('Dismissed from pending actions');
      return;
    }
    setActioning(id, true);
    remove(id);
    setDismissingId(null);
    setNotice('Dismissed from pending actions');
    try {
      await api.post(`/expenses/${id}/dismiss`, { dismissal_reason: dismissalReason });
      Promise.all([
        removeExpenseFromCachedLists(id),
        removeExpenseSnapshot(id),
        invalidateExpenseMutationCaches(),
      ]).catch(() => {});
    } catch {
      restore(dismissed);
      setNotice('Could not dismiss. Try again.');
    } finally {
      setActioning(id, false);
    }
  }

  async function approve(id) {
    if (actioningIdsRef.current.has(id)) return;
    const item = displayExpenses.find((entry) => entry.id === id);
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      setNotice('Approved and moved into your expenses');
      return;
    }
    setActioning(id, true);
    remove(id);
    setNotice('Approved and moved into your expenses');
    try {
      const reviewContext = item?.gmail_review_hint?.review_mode === 'quick_check'
        ? 'quick_check'
        : null;
      const approved = await api.post(`/expenses/${id}/approve`, reviewContext ? { review_context: reviewContext } : {});
      if (approved?.id) {
        Promise.all([
          saveExpenseSnapshot(approved),
          patchExpenseInCachedLists(approved),
          invalidateExpenseMutationCaches(),
        ]).catch(() => {});
      }
    } catch {
      restore(item);
      setNotice('Could not approve. Try again.');
    } finally {
      setActioning(id, false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.reviewTabs} accessibilityRole="tablist">
          {[{ key: 'pending', label: 'Pending' }, { key: 'skipped', label: 'Skipped' }].map((tab) => (
            <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: reviewTab === tab.key }}
              onPress={() => setReviewTab(tab.key)} style={[styles.reviewTab, reviewTab === tab.key && styles.reviewTabActive]}>
              <Text style={[styles.reviewTabText, reviewTab === tab.key && styles.reviewTabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
        {reviewTab === 'skipped' ? (
          <SkippedImportsList isUsingMockData={isUsingMockData} onRecovered={() => {
            Promise.all([refresh(), invalidateExpenseMutationCaches()]).catch(() => {});
          }} />
        ) : <FlatList
          data={queueRows}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            item.type === 'group' ? (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{item.title}</Text>
                <Text style={styles.groupCount}>{item.count}</Text>
              </View>
            ) : (
              <ReviewQueueItem
                item={item.expense}
                disabled={actioningIds.has(item.expense.id)}
                onOpen={openReviewEntry}
                onApprove={approve}
                onDismiss={requestDismiss}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.expense.id)}
                onToggleSelection={toggleSelection}
              />
            )
          )}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => refresh({ forceRefresh: true })} tintColor={colors.text} />}
          contentContainerStyle={[styles.list, selectionMode && styles.listSelecting]}
          onEndReached={() => { if (hasMore && !loadingMore) loadMore(); }}
          onEndReachedThreshold={0.35}
          ListHeaderComponent={(
            <View style={styles.header}>
              <Text style={styles.eyebrow}>Pending actions</Text>
              <Text style={styles.title}>
                {totalActions > 0 ? `${totalActions} thing${totalActions === 1 ? '' : 's'} to clear` : 'You are caught up'}
              </Text>
              <Text style={styles.subtitle}>Things that need your attention before they settle into the app.</Text>

              {totalActions > 0 && hasSecondarySummary ? (
                <View style={styles.summaryRow}>
                  {reviewModeCounts.quickCheck > 0 ? (
                    <View style={styles.summaryPill}>
                      <Text style={styles.summaryPillValue}>{reviewModeCounts.quickCheck}</Text>
                      <Text style={styles.summaryPillLabel}>quick checks</Text>
                    </View>
                  ) : null}
                  {reviewModeCounts.itemsFirst > 0 ? (
                    <View style={styles.summaryPill}>
                      <Text style={styles.summaryPillValue}>{reviewModeCounts.itemsFirst}</Text>
                      <Text style={styles.summaryPillLabel}>item reviews</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{selectionMode ? `${selectedIds.size} selected` : 'Review imports'}</Text>
                {displayExpenses.length > 0 ? (selectionMode ? (
                  <Pressable style={styles.selectButton} onPress={leaveSelectionMode}>
                    <Text style={styles.selectButtonText}>Done</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.selectButton} onPress={() => setSelectionMode(true)}>
                    <Ionicons name="checkmark-circle-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.selectButtonText}>Select</Text>
                  </Pressable>
                )) : null}
              </View>
            </View>
          )}
          ListEmptyComponent={
            loading
              ? <LoadingRows />
              : (
              error
                ? <Text style={styles.error}>{error}</Text>
                : <Text style={styles.empty}>Nothing needs your attention right now. New review work will land here when it needs you.</Text>
              )
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.loadingMore} color={colors.textMuted} /> : null}
        />}
        {reviewTab === 'pending' && selectionMode ? (
          <View style={styles.batchBar}>
            <View style={styles.batchSummary}>
              <Text style={styles.batchTitle}>{selectedIds.size ? `${selectedIds.size} selected` : 'Choose imports'}</Text>
              <Text style={styles.batchHint}>{selectedHasDuplicate ? 'Duplicates must be compared individually.' : selectedHasItemsFirst ? 'Item-first imports must be opened before approval.' : 'Approve or dismiss this selection together.'}</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={!selectedIds.size || Boolean(batchActioning)} onPress={() => setDismissingId('__bulk__')} style={[styles.batchIconButton, (!selectedIds.size || batchActioning) && styles.batchDisabled]}>
              {batchActioning === 'dismiss' ? <ActivityIndicator color={colors.danger} /> : <Ionicons name="trash-outline" size={20} color={colors.danger} />}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!canBatchApprove || Boolean(batchActioning)} onPress={() => runBatch('approve')} style={[styles.batchApproveButton, (!canBatchApprove || batchActioning) && styles.batchDisabled]}>
              {batchActioning === 'approve' ? <ActivityIndicator color={colors.textInverse} /> : <><Ionicons name="checkmark" size={18} color={colors.textInverse} /><Text style={styles.batchApproveText}>Approve</Text></>}
            </Pressable>
          </View>
        ) : null}
        <ActionNotice message={notice} />
        <DismissReasonSheet
          visible={!!dismissingId}
          onClose={() => setDismissingId(null)}
          onSelect={(reason) => dismissingId === '__bulk__' ? runBatch('dismiss', reason) : dismiss(dismissingId, reason)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  reviewTabs: { flexDirection: 'row', marginHorizontal: 16, marginVertical: 12, backgroundColor: colors.surface, borderRadius: 8, padding: 3 },
  reviewTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, borderRadius: 6 },
  reviewTabActive: { backgroundColor: colors.surfacePressed },
  reviewTabText: { color: colors.textSubtle, fontSize: 14, fontWeight: '600' },
  reviewTabTextActive: { color: colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  listSelecting: { paddingBottom: 124 },
  header: {
    paddingTop: 4,
    paddingBottom: 14,
    marginBottom: 10,
    backgroundColor: colors.background,
  },
  eyebrow: {
    color: colors.textSubtle,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSubtle, lineHeight: 20, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  summaryPill: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textInverse,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  summaryPillValue: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 2 },
  summaryPillLabel: { color: colors.textSubtle, fontSize: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textDisabled, letterSpacing: 0.2 },
  selectButton: { minHeight: 36, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectButtonText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingBottom: 4,
  },
  groupTitle: { color: colors.textSubtle, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  groupCount: { color: colors.textDisabled, fontSize: 12, fontWeight: '700' },
  loadingRows: { paddingTop: 10 },
  loadingRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    gap: 8,
  },
  loadingLineWide: { width: '54%', height: 13, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  loadingLine: { width: '78%', height: 10, borderRadius: 4, backgroundColor: colors.surface },
  loadingLineShort: { width: '42%', height: 10, borderRadius: 4, backgroundColor: colors.surface },
  empty: { color: colors.textDisabled, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  loadingMore: { paddingVertical: 20 },
  batchBar: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 96, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  batchSummary: { flex: 1, minWidth: 0 },
  batchTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  batchHint: { color: colors.textSubtle, fontSize: 11, lineHeight: 15, marginTop: 3 },
  batchIconButton: { width: 46, height: 46, borderRadius: 8, borderWidth: 1, borderColor: colors.dangerMuted, alignItems: 'center', justifyContent: 'center' },
  batchApproveButton: { minHeight: 46, borderRadius: 8, backgroundColor: colors.text, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  batchApproveText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  batchDisabled: { opacity: 0.42 },
});
