import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useExpenses } from '../../hooks/useExpenses';
import { useBudget } from '../../hooks/useBudget';
import { ExpenseItem } from '../../components/ExpenseItem';
import { BudgetBar } from '../../components/BudgetBar';

export default function FeedScreen() {
  const { expenses, loading, refresh } = useExpenses();
  const { budget } = useBudget();
  const router = useRouter();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);

  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);

  const handleDelete = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  const monthlyTotal = displayExpenses
    .filter(e => e.date?.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.totalLabel}>This month</Text>
        <Text style={styles.total}>${monthlyTotal.toFixed(2)}</Text>
        {budget?.total && (
          <BudgetBar spent={budget.total.spent} limit={budget.total.limit} />
        )}
      </View>
      <FlatList
        data={displayExpenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} onDelete={handleDelete} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap Add to get started.</Text>
        }
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/add')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  totalLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  total: { fontSize: 32, color: '#fff', fontWeight: '700', marginTop: 4 },
  list: { padding: 16 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: { fontSize: 28, color: '#000', lineHeight: 32, fontWeight: '300' },
});
