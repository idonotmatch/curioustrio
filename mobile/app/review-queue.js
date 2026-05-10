import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionNotice } from '../components/ActionNotice';
import { DismissReasonSheet } from '../components/DismissReasonSheet';
import { usePendingExpenses, removePendingExpense } from '../hooks/usePendingExpenses';
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
  const { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);
  const [notice, setNotice] = useState('');
  const [dismissingId, setDismissingId] = useState(null);
  const reviewModeCounts = summarizeReviewModes(displayExpenses);
  const queueRows = buildQueueRows(displayExpenses);
  const totalActions = displayExpenses.length;
  const hasSecondarySummary = reviewModeCounts.quickCheck > 0 || reviewModeCounts.itemsFirst > 0;

  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  const remove = (id) => {
    setDisplayExpenses((prev) => prev.filter((expense) => expense.id !== id));
    removePendingExpense(id);
  };

  function requestDismiss(id) {
    setDismissingId(id);
  }

  async function dismiss(id, dismissalReason) {
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      setDismissingId(null);
      setNotice('Dismissed from pending actions');
      return;
    }
    try {
      await api.post(`/expenses/${id}/dismiss`, { dismissal_reason: dismissalReason });
      await removeExpenseFromCachedLists(id);
      await removeExpenseSnapshot(id);
      await invalidateExpenseMutationCaches();
      remove(id);
      setDismissingId(null);
      setNotice('Dismissed from pending actions');
    } catch {
      // ignore
    }
  }

  async function approve(id) {
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      setNotice('Approved and moved into your expenses');
      return;
    }
    try {
      const item = displayExpenses.find((entry) => entry.id === id);
      const reviewContext = item?.gmail_review_hint?.review_mode === 'quick_check'
        ? 'quick_check'
        : null;
      const approved = await api.post(`/expenses/${id}/approve`, reviewContext ? { review_context: reviewContext } : {});
      if (approved?.id) {
        await saveExpenseSnapshot(approved);
        await patchExpenseInCachedLists(approved);
      }
      await invalidateExpenseMutationCaches();
      remove(id);
      setNotice('Approved and moved into your expenses');
    } catch {
      // ignore
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <FlatList
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
                onOpen={(entry) => router.push({
                  pathname: '/expense/[id]',
                  params: {
                    id: entry.id,
                    expense: JSON.stringify(entry),
                  },
                })}
                onApprove={approve}
                onDismiss={requestDismiss}
              />
            )
          )}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.text} />}
          contentContainerStyle={styles.list}
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
                <Text style={styles.sectionTitle}>Review imports</Text>
                {displayExpenses.length > 0 ? (
                  <Text style={styles.hint}>{isUsingMockData ? 'Dev preview' : `${displayExpenses.length} open`}</Text>
                ) : null}
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
        />
        <ActionNotice message={notice} />
        <DismissReasonSheet
          visible={!!dismissingId}
          onClose={() => setDismissingId(null)}
          onSelect={(reason) => dismiss(dismissingId, reason)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
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
});
