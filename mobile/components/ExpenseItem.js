import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export function ExpenseItem({ expense, onPress }) {
  return (
    <TouchableOpacity style={styles.container} onPress={() => onPress?.(expense)}>
      <View style={styles.left}>
        <Text style={styles.merchant}>{expense.merchant}</Text>
        <Text style={styles.meta}>
          {expense.category_name || 'Unclassified'} · {expense.date}
        </Text>
      </View>
      <Text style={styles.amount}>${Number(expense.amount).toFixed(2)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  left: { flex: 1 },
  merchant: { fontSize: 14, color: '#fff', fontWeight: '600' },
  meta: { fontSize: 11, color: '#666', marginTop: 2 },
  amount: { fontSize: 16, color: '#fff', fontWeight: '700' },
});
