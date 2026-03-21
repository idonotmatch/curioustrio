import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { ExpenseItem } from '../../components/ExpenseItem';
import { DuplicateAlert } from '../../components/DuplicateAlert';
import { api } from '../../services/api';

export default function PendingScreen() {
  const { expenses, loading, refresh } = usePendingExpenses();

  async function dismiss(id) {
    try {
      await api.post(`/expenses/${id}/dismiss`);
      refresh();
    } catch (err) {
      // silently ignore dismiss errors
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={expenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View>
            <ExpenseItem expense={item} />
            {item.duplicate_flags?.length > 0 && (
              <DuplicateAlert
                flags={item.duplicate_flags}
                onDismiss={() => dismiss(item.id)}
              />
            )}
          </View>
        )}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && (
            <Text style={styles.empty}>No pending expenses. You're all caught up!</Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { padding: 16 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },
});
