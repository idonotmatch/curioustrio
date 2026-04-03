import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Ionicons } from '@expo/vector-icons';

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
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

export function ExpenseItem({ expense, categories = [], showUser = false, onDelete, pending = false }) {
  const router = useRouter();
  const { userId: currentUserId } = useCurrentUser();
  const [localExpense, setLocalExpense] = useState(expense);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categorySavingId, setCategorySavingId] = useState(null);

  useEffect(() => {
    setLocalExpense(expense);
  }, [expense]);

  const isOwn = !currentUserId || String(localExpense.user_id) === String(currentUserId);
  const color = categoryColor(localExpense.category_name);
  const isRefund = Number(localExpense.amount) < 0;
  const categoryLabel = localExpense.category_parent_name || localExpense.category_name || 'Uncategorized';
  const ownerLabel = isOwn ? 'You' : (localExpense.user_name || 'Household member');
  const categoryOptions = categories.filter(c => !c.parent_id || c.parent_name);

  async function toggleItems() {
    if (itemsExpanded) {
      setItemsExpanded(false);
      return;
    }
    setItemsExpanded(true);
    if (items !== null) return;
    setItemsLoading(true);
    try {
      const detail = await api.get(`/expenses/${localExpense.id}`);
      setItems(Array.isArray(detail.items) ? detail.items : []);
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }

  async function handleCategorySelect(category) {
    if (!isOwn || pending || categorySavingId === category.id) return;
    setCategorySavingId(category.id);
    try {
      await api.patch(`/expenses/${localExpense.id}`, { category_id: category.id });
      await Promise.all([
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      setLocalExpense(prev => ({
        ...prev,
        category_id: category.id,
        category_name: category.name,
        category_parent_name: category.parent_name || null,
      }));
      setCategoryPickerOpen(false);
    } catch {
      // Preserve the current row state if the update fails.
    } finally {
      setCategorySavingId(null);
    }
  }

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={async () => {
        try {
          await api.delete(`/expenses/${localExpense.id}`);
          await Promise.all([
            invalidateCacheByPrefix('cache:expenses:'),
            invalidateCacheByPrefix('cache:budget:'),
            invalidateCacheByPrefix('cache:household-expenses:'),
          ]);
          onDelete?.(localExpense.id);
        } catch {
          // Item stays in list if delete fails.
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
          onPress={() => router.push(`/expense/${localExpense.id}`)}
          activeOpacity={0.7}
        >
          <View style={[styles.accent, { backgroundColor: pending ? '#f59e0b' : color }]} />
          <View style={styles.left}>
            <View style={styles.headerRow}>
              <Text style={styles.merchant} numberOfLines={1}>{localExpense.merchant}</Text>
              <Text style={styles.metaText}>{formatDate(localExpense.date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <TouchableOpacity
                style={[styles.categoryChip, categoryPickerOpen && styles.categoryChipActive, !isOwn && styles.categoryChipStatic]}
                onPress={isOwn && !pending ? () => setCategoryPickerOpen(open => !open) : undefined}
                activeOpacity={isOwn && !pending ? 0.7 : 1}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.categoryChipText} numberOfLines={1}>{categoryLabel}</Text>
                {isOwn && !pending ? (
                  categorySavingId ? (
                    <ActivityIndicator size="small" color="#777" style={styles.categorySpinner} />
                  ) : (
                    <Ionicons
                      name={categoryPickerOpen ? 'chevron-up' : 'chevron-down'}
                      size={11}
                      color="#777"
                      style={styles.categoryChevron}
                    />
                  )
                ) : null}
              </TouchableOpacity>
              {showUser ? (
                <View style={[styles.ownerChip, isOwn && styles.ownerChipOwn]}>
                  <Text style={[styles.ownerChipText, isOwn && styles.ownerChipTextOwn]}>{ownerLabel}</Text>
                </View>
              ) : null}
              {showUser && localExpense.is_private ? <Text style={styles.privateLabel}>Private</Text> : null}
              {localExpense.place_name ? <Text style={styles.metaText} numberOfLines={1}>· {localExpense.place_name}</Text> : null}
            </View>
          </View>
          <Text style={[styles.amount, isRefund && styles.amountRefund]}>
            {isRefund ? '−' : ''}${Math.abs(Number(localExpense.amount)).toFixed(2)}
          </Text>
        </TouchableOpacity>

        {categoryPickerOpen && isOwn && !pending && categoryOptions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryPicker}
            contentContainerStyle={styles.categoryPickerContent}
          >
            {categoryOptions.map(category => {
              const active = localExpense.category_id === category.id;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.categoryOptionChip, active && styles.categoryOptionChipActive]}
                  onPress={() => handleCategorySelect(category)}
                  disabled={!!categorySavingId}
                >
                  <Text style={[styles.categoryOptionText, active && styles.categoryOptionTextActive]}>
                    {category.parent_name || category.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {localExpense.item_count > 0 && (
          <TouchableOpacity style={styles.itemToggleRow} onPress={toggleItems} activeOpacity={0.7}>
            <Text style={styles.itemCount}>
              {localExpense.item_count} {localExpense.item_count === 1 ? 'item' : 'items'}
            </Text>
            <Ionicons name={itemsExpanded ? 'chevron-up' : 'chevron-down'} size={12} color="#777" />
          </TouchableOpacity>
        )}

        {itemsExpanded && localExpense.item_count > 0 && (
          <View style={styles.itemsPanel}>
            {itemsLoading ? (
              <ActivityIndicator size="small" color="#777" style={{ paddingVertical: 8 }} />
            ) : items?.length ? (
              <>
                {items.slice(0, 5).map((item, index) => (
                  <View key={`${localExpense.id}-${index}`} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.description}</Text>
                    <Text style={styles.itemAmount}>
                      {item.amount != null ? `$${Number(item.amount).toFixed(2)}` : ''}
                    </Text>
                  </View>
                ))}
                {items.length > 5 ? <Text style={styles.itemMore}>+{items.length - 5} more items in receipt</Text> : null}
              </>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  merchant: {
    flexShrink: 1,
    fontSize: 15,
    color: '#f5f5f5',
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginRight: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '65%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryChipActive: {
    borderColor: '#333',
  },
  categoryChipStatic: {
    paddingRight: 10,
  },
  categoryChipText: {
    color: '#d7d7d7',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  categoryChevron: {
    marginLeft: 4,
  },
  categorySpinner: {
    marginLeft: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#888',
  },
  ownerChip: {
    backgroundColor: '#181818',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ownerChipOwn: {
    backgroundColor: '#1a2230',
  },
  ownerChipText: {
    color: '#a8a8a8',
    fontSize: 11,
    fontWeight: '600',
  },
  ownerChipTextOwn: {
    color: '#cfe0ff',
  },
  privateLabel: {
    color: '#777',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  amount: {
    fontSize: 16,
    color: '#f5f5f5',
    fontWeight: '600',
    paddingRight: 14,
    letterSpacing: -0.3,
  },
  amountRefund: {
    color: '#4ade80',
  },
  categoryPicker: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: '#1b1b1b',
  },
  categoryPickerContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  categoryOptionChip: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryOptionChipActive: {
    backgroundColor: '#f5f5f5',
    borderColor: '#f5f5f5',
  },
  categoryOptionText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '500',
  },
  categoryOptionTextActive: {
    color: '#0a0a0a',
  },
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
  deleteText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  itemCount: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
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
  itemName: {
    flex: 1,
    color: '#cfcfcf',
    fontSize: 13,
  },
  itemAmount: {
    color: '#a8a8a8',
    fontSize: 12,
  },
  itemEmpty: {
    color: '#777',
    fontSize: 12,
  },
  itemMore: {
    color: '#777',
    fontSize: 12,
    marginTop: 4,
  },
});
