import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { ExpenseItem } from '../../components/ExpenseItem';

export default function HouseholdScreen() {
  const { expenses, loading, refresh, total } = useHouseholdExpenses();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.totalLabel}>Household this month</Text>
        <Text style={styles.total}>${total.toFixed(2)}</Text>
      </View>
      <FlatList
        data={expenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} showUser />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && (
            <Text style={styles.empty}>
              You're not in a household yet. Add members in Settings.
            </Text>
          )
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
