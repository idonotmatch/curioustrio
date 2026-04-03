import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Ionicons } from '@expo/vector-icons';

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
  const clean = dateStr.slice(0, 10) + 'T12:00:00';
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
  const { userId: currentUserId } = useCurrentUser();
  const isOwn = !currentUserId || String(expense.user_id) === String(currentUserId);
  const color = categoryColor(expense.category_name);
  const isRefund = Number(expense.amount) < 0;
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState(null);

  async function toggleItems() {
    if (itemsExpanded) {
      setItemsExpanded(false);
      return;
    }
    setItemsExpanded(true);
    if (items !== null) return;
    setItemsLoading(true);
    try {
      const detail = await api.get(`/expenses/${expense.id}`);
      setItems(Array.isArray(detail.items) ? detail.items : []);
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={async () => {
        try {
          await api.delete(`/expenses/${expense.id}`);
          await Promise.all([
            invalidateCacheByPrefix('cache:expenses:'),
            invalidateCacheByPrefix('cache:budget:'),
            invalidateCacheByPrefix('cache:household-expenses:'),
          ]);
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
      <View style={[styles.container, pending && styles.containerPending]}>
        <TouchableOpacity
          style={styles.rowPress}
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
          </View>
          <Text style={[styles.amount, isRefund && styles.amountRefund]}>
            {isRefund ? '−' : ''}${Math.abs(Number(expense.amount)).toFixed(2)}
          </Text>
        </TouchableOpacity>
        {expense.item_count > 0 && (
          <TouchableOpacity style={styles.itemToggleRow} onPress={toggleItems} activeOpacity={0.7}>
            <Text style={styles.itemCount}>
              {expense.item_count} {expense.item_count === 1 ? 'item' : 'items'}
            </Text>
            <Ionicons
              name={itemsExpanded ? 'chevron-up' : 'chevron-down'}
              size={12}
              color="#777"
            />
          </TouchableOpacity>
        )}
        {itemsExpanded && expense.item_count > 0 && (
          <View style={styles.itemsPanel}>
            {itemsLoading ? (
              <ActivityIndicator size="small" color="#777" style={{ paddingVertical: 8 }} />
            ) : items?.length ? (
              items.map((item, index) => (
                <View key={`${expense.id}-${index}`} style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.description}</Text>
                  <Text style={styles.itemAmount}>
                    {item.amount != null ? `$${Number(item.amount).toFixed(2)}` : ''}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.itemEmpty}>No item details available</Text>
            )}
          </View>
        )}
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 10,
    marginBottom: 6,
    overflow: 'hidden',
  },
  rowPress: {
    flexDirection: 'row',
    alignItems: 'center',
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
  merchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500', letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 6 },
  meta: { fontSize: 13, color: '#999' },
  amount: {
    fontSize: 16,
    color: '#f5f5f5',
    fontWeight: '600',
    paddingRight: 14,
    letterSpacing: -0.3,
  },
  amountRefund: { color: '#4ade80' },
  itemToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginLeft: 3,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  deleteAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    borderRadius: 10,
    marginBottom: 6,
  },
  deleteText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  itemCount: { fontSize: 12, color: '#888', marginTop: 2 },
  itemsPanel: {
    borderTopWidth: 1,
    borderTopColor: '#1b1b1b',
    marginLeft: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  itemName: { flex: 1, color: '#cfcfcf', fontSize: 13 },
  itemAmount: { color: '#a8a8a8', fontSize: 12 },
  itemEmpty: { color: '#777', fontSize: 12 },
});
