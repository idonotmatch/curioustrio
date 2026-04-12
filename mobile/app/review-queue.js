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
import { removeExpenseSnapshot, saveExpenseSnapshot } from '../services/expenseLocalStore';

export default function ReviewQueueScreen() {
  const router = useRouter();
  const { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);
  const [notice, setNotice] = useState('');
  const [dismissingId, setDismissingId] = useState(null);

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
      setNotice('Dismissed from your review queue');
      return;
    }
    try {
      await api.post(`/expenses/${id}/dismiss`, { dismissal_reason: dismissalReason });
      await removeExpenseSnapshot(id);
      await invalidateCache('cache:expenses:pending');
      remove(id);
      setDismissingId(null);
      setNotice('Dismissed from your review queue');
    } catch {
      // ignore
    }
  }

  async function approve(id) {
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      setNotice('Approved and added to your expenses');
      return;
    }
    try {
      const item = displayExpenses.find((entry) => entry.id === id);
      const reviewContext = item?.gmail_review_hint?.review_mode === 'quick_check'
        ? 'quick_check'
        : null;
      const approved = await api.post(`/expenses/${id}/approve`, reviewContext ? { review_context: reviewContext } : {});
      if (approved?.id) await saveExpenseSnapshot(approved);
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      remove(id);
      setNotice('Approved and added to your expenses');
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
              <Text style={styles.subtitle}>Confirm your Gmail imports before they are counted.</Text>
              {displayExpenses.length > 0 ? (
                <Text style={styles.hint}>{isUsingMockData ? 'Dev preview queue' : 'Swipe to approve or dismiss'}</Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            !loading && (
              error
                ? <Text style={styles.error}>{error}</Text>
                : <Text style={styles.empty}>Nothing in your review queue. You're all caught up!</Text>
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
    paddingBottom: 10,
    marginBottom: 8,
    backgroundColor: '#0a0a0a',
  },
  subtitle: { fontSize: 13, color: '#8a8a8a', marginBottom: 8 },
  hint: { fontSize: 12, color: '#444', textAlign: 'center', letterSpacing: 0.3 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },
  error: { color: '#fca5a5', textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
