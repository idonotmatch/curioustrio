import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionNotice } from '../components/ActionNotice';
import { DismissReasonSheet } from '../components/DismissReasonSheet';
import { usePendingExpenses, removePendingExpense } from '../hooks/usePendingExpenses';
import { ReviewQueueItem } from '../components/ReviewQueueItem';
import { api } from '../services/api';
import { invalidateCache, invalidateCacheByPrefix } from '../services/cache';
import { patchExpenseInCachedLists, removeExpenseFromCachedLists, removeExpenseSnapshot, saveExpenseSnapshot } from '../services/expenseLocalStore';

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

export default function ReviewQueueScreen() {
  const router = useRouter();
  const { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);
  const [notice, setNotice] = useState('');
  const [dismissingId, setDismissingId] = useState(null);
  const reviewModeCounts = summarizeReviewModes(displayExpenses);
  const totalActions = displayExpenses.length;

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
      await invalidateCache('cache:expenses:pending');
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
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
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
          data={displayExpenses}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ReviewQueueItem
              item={item}
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
          )}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={(
            <View style={styles.header}>
              <Text style={styles.eyebrow}>Pending actions</Text>
              <Text style={styles.title}>
                {totalActions > 0 ? `${totalActions} thing${totalActions === 1 ? '' : 's'} to clear` : 'You are caught up'}
              </Text>
              <Text style={styles.subtitle}>Things that need your attention before they settle into the app.</Text>

              {totalActions > 0 ? (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillValue}>{totalActions}</Text>
                    <Text style={styles.summaryPillLabel}>waiting now</Text>
                  </View>
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
                  <Text style={styles.hint}>{isUsingMockData ? 'Dev preview actions' : 'Swipe to approve or dismiss'}</Text>
                ) : null}
              </View>
            </View>
          )}
          ListEmptyComponent={
            !loading && (
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
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  header: {
    paddingTop: 4,
    paddingBottom: 14,
    marginBottom: 10,
    backgroundColor: '#0a0a0a',
  },
  eyebrow: {
    color: '#8a8a8a',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  title: { color: '#f5f5f5', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#8a8a8a', lineHeight: 20, marginBottom: 14 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  summaryPill: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  summaryPillValue: { color: '#f5f5f5', fontSize: 18, fontWeight: '700', marginBottom: 2 },
  summaryPillLabel: { color: '#8a8a8a', fontSize: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#666', letterSpacing: 0.2 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40, lineHeight: 20 },
  error: { color: '#fca5a5', textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
