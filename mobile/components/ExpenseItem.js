import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';

// Muted category color palette — seeded by category name
const CATEGORY_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#f97316'];
function categoryColor(name) {
  if (!name) return '#333';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return CATEGORY_COLORS[Math.abs(h) % CATEGORY_COLORS.length];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
  const date = new Date(clean);
  if (isNaN(date)) return dateStr;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

export function ExpenseItem({ expense, showUser = false, onDelete, pending = false }) {
  const router = useRouter();
  const currentUserId = useCurrentUser();
  const isOwn = !currentUserId || String(expense.user_id) === String(currentUserId);
  const color = categoryColor(expense.category_name);
  const isRefund = Number(expense.amount) < 0;

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={async () => {
        try {
          await api.delete(`/expenses/${expense.id}`);
          onDelete?.(expense.id);
        } catch {
          // item stays in list if delete fails
        }
      }}
    >
      <Text style={styles.deleteText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={isOwn ? renderRightActions : undefined}>
      <TouchableOpacity
        style={[styles.container, pending && styles.containerPending]}
        onPress={() => router.push(`/expense/${expense.id}`)}
        activeOpacity={0.7}
      >
        <View style={[styles.accent, { backgroundColor: pending ? '#f59e0b' : color }]} />
        <View style={styles.left}>
          <Text style={styles.merchant} numberOfLines={1}>{expense.merchant}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text style={styles.meta}>
              {expense.category_parent_name || expense.category_name || 'Uncategorized'}
              {showUser && expense.user_name ? ` · ${expense.user_name}` : ''}
              {' · '}{formatDate(expense.date)}
              {expense.place_name ? ` · 📍 ${expense.place_name}` : ''}
            </Text>
          </View>
          {expense.item_count > 0 && (
            <Text style={styles.itemCount}>
              {expense.item_count} {expense.item_count === 1 ? 'item' : 'items'}
            </Text>
          )}
        </View>
        <Text style={[styles.amount, isRefund && styles.amountRefund]}>
          {isRefund ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 10,
    marginBottom: 6,
    overflow: 'hidden',
  },
  containerPending: {
    backgroundColor: '#141008',
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
  },
  left: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  merchant: { fontSize: 14, color: '#f5f5f5', fontWeight: '500', letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 6 },
  meta: { fontSize: 11, color: '#555' },
  amount: {
    fontSize: 15,
    color: '#f5f5f5',
    fontWeight: '600',
    paddingRight: 14,
    letterSpacing: -0.3,
  },
  amountRefund: { color: '#4ade80' },
  deleteAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    borderRadius: 10,
    marginBottom: 6,
  },
  deleteText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  itemCount: { fontSize: 10, color: '#444', marginTop: 2 },
});
