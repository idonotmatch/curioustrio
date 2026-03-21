import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';

export function ExpenseItem({ expense, onPress, showUser = false, onDelete }) {
  const router = useRouter();

  const renderRightActions = () => (
    <TouchableOpacity
      style={{ backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 80 }}
      onPress={async () => {
        try {
          await api.delete(`/expenses/${expense.id}`);
          onDelete?.(expense.id);
        } catch (e) {
          // ignore — item stays in list if delete fails
        }
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <TouchableOpacity style={styles.container} onPress={() => router.push(`/expense/${expense.id}`)}>
        <View style={styles.left}>
          <Text style={styles.merchant}>{expense.merchant}</Text>
          {showUser && expense.user_name ? (
            <Text style={styles.userName}>{expense.user_name}</Text>
          ) : null}
          <Text style={styles.meta}>
            {expense.category_name || 'Unclassified'} · {expense.date}
          </Text>
        </View>
        <Text style={styles.amount}>${Number(expense.amount).toFixed(2)}</Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  left: { flex: 1 },
  merchant: { fontSize: 14, color: '#fff', fontWeight: '600' },
  userName: { fontSize: 11, color: '#888', marginTop: 2 },
  meta: { fontSize: 11, color: '#666', marginTop: 2 },
  amount: { fontSize: 16, color: '#fff', fontWeight: '700' },
});
