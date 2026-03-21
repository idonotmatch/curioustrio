import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useExpenses } from '../../hooks/useExpenses';
import { useBudget } from '../../hooks/useBudget';
import { ExpenseItem } from '../../components/ExpenseItem';
import { BudgetBar } from '../../components/BudgetBar';

export default function FeedScreen() {
  const { expenses, loading, refresh } = useExpenses();
  const { budget } = useBudget();

  const monthlyTotal = expenses
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
        data={expenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap Add to get started.</Text>
        }
      />
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
});
