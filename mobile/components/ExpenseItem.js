import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { invalidateCacheByPrefix } from '../services/cache';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Ionicons } from '@expo/vector-icons';
import { loadExpenseItemsSnapshot, loadExpenseSnapshot, saveExpenseSnapshot, removeExpenseSnapshot } from '../services/expenseLocalStore';

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

function normalizeComparableText(value) {
  return `${value || ''}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function deriveLocationLabel(expense = {}) {
  const merchant = normalizeComparableText(expense.merchant);
  const placeName = `${expense.place_name || ''}`.trim();
  const normalizedPlace = normalizeComparableText(placeName);
  if (placeName && normalizedPlace && normalizedPlace !== merchant && !normalizedPlace.includes(merchant)) {
    return placeName;
  }
  return null;
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

  useEffect(() => {
    let cancelled = false;

    async function hydrateLocalItemAvailability() {
      const snapshot = await loadExpenseSnapshot(expense?.id);
      if (cancelled || !snapshot?.id) return;

      if (Array.isArray(snapshot.items)) {
        setLocalExpense((prev) => ({
          ...prev,
          items: snapshot.items,
          item_count: snapshot.items.length,
        }));
        return;
      }

      if (Number(snapshot.item_count) === 0) {
        setLocalExpense((prev) => ({
          ...prev,
          item_count: 0,
          items: [],
        }));
      }
    }

    hydrateLocalItemAvailability();
    return () => {
      cancelled = true;
    };
  }, [expense?.id]);

  const isOwn = !currentUserId || String(localExpense.user_id) === String(currentUserId);
  const color = categoryColor(localExpense.category_name);
  const isRefund = Number(localExpense.amount) < 0;
  const categoryLabel = localExpense.category_parent_name || localExpense.category_name || 'Uncategorized';
  const locationLabel = deriveLocationLabel(localExpense);
  const ownerLabel = isOwn ? 'You' : (localExpense.user_name || 'Household member');
  const categoryOptions = categories.filter(c => !c.parent_id || c.parent_name);
  const dateLabel = formatDate(localExpense.date);
  const hasItemDetails = Array.isArray(localExpense.items)
    ? localExpense.items.length > 0
    : Number(localExpense.item_count) > 0;

  async function toggleItems() {
    if (itemsExpanded) {
      setItemsExpanded(false);
      return;
    }
    setItemsExpanded(true);
    if (items !== null) return;
    if (Array.isArray(localExpense.items)) {
      setItems(localExpense.items);
      return;
    }
    setItemsLoading(true);
    try {
      const cachedItems = await loadExpenseItemsSnapshot(localExpense.id);
      if (cachedItems) {
        setItems(cachedItems);
        setItemsLoading(false);
      }
      const detail = await api.get(`/expenses/${localExpense.id}`);
      const nextItems = Array.isArray(detail.items) ? detail.items : [];
      setItems(nextItems);
      if (!nextItems.length) {
        const nextExpense = {
          ...localExpense,
          item_count: 0,
          items: [],
        };
        setLocalExpense(nextExpense);
        setItemsExpanded(false);
        saveExpenseSnapshot(nextExpense);
      } else {
        const nextExpense = {
          ...detail,
          item_count: nextItems.length,
          items: nextItems,
        };
        setLocalExpense(nextExpense);
        saveExpenseSnapshot(nextExpense);
      }
    } catch {
      setItems(prev => prev ?? []);
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
      saveExpenseSnapshot({
        ...localExpense,
        category_id: category.id,
        category_name: category.name,
        category_parent_name: category.parent_name || null,
      });
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
          await removeExpenseSnapshot(localExpense.id);
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
          onPress={() => router.push({
            pathname: '/expense/[id]',
            params: {
              id: localExpense.id,
              expense: JSON.stringify(localExpense),
            },
          })}
          activeOpacity={0.7}
        >
          <View style={[styles.accent, { backgroundColor: pending ? '#f59e0b' : color }]} />
          <View style={styles.left}>
            <View style={styles.headerRow}>
              <View style={styles.titleWrap}>
                <View style={styles.titleRow}>
                  <Text style={styles.merchant} numberOfLines={1}>{localExpense.merchant}</Text>
                  <Text style={styles.dateInline} numberOfLines={1}>{dateLabel}</Text>
                </View>
              </View>
              <View style={styles.rightCol}>
                <Text style={[styles.amount, isRefund && styles.amountRefund]}>
                  {isRefund ? '−' : ''}${Math.abs(Number(localExpense.amount)).toFixed(2)}
                </Text>
              </View>
            </View>
            <View style={styles.detailChipRow}>
              <TouchableOpacity
                style={[styles.categoryChipInline, categoryPickerOpen && styles.categoryChipInlineActive, (!isOwn || pending) && styles.categoryChipInlineStatic]}
                onPress={isOwn && !pending && categoryOptions.length > 0 ? () => setCategoryPickerOpen(open => !open) : undefined}
                activeOpacity={isOwn && !pending && categoryOptions.length > 0 ? 0.7 : 1}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={styles.categoryChipText} numberOfLines={1}>{categoryLabel}</Text>
                {isOwn && !pending && categoryOptions.length > 0 ? (
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
              {(showUser || localExpense.is_private) ? (
                <View style={styles.ownerRow}>
                  {showUser ? (
                    <View style={[styles.ownerChip, isOwn && styles.ownerChipOwn]}>
                      <Text style={[styles.ownerChipText, isOwn && styles.ownerChipTextOwn]}>{ownerLabel}</Text>
                    </View>
                  ) : null}
                  {showUser && localExpense.is_private ? <Text style={styles.privateLabel}>Private</Text> : null}
                </View>
              ) : null}
            </View>
            {locationLabel ? (
              <Text style={styles.locationMetaText} numberOfLines={1}>{locationLabel}</Text>
            ) : null}
          </View>
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

        {hasItemDetails && (
          <TouchableOpacity style={styles.itemToggleRow} onPress={toggleItems} activeOpacity={0.7}>
            <Text style={styles.itemCount}>
              {Array.isArray(localExpense.items) ? localExpense.items.length : localExpense.item_count} {(Array.isArray(localExpense.items) ? localExpense.items.length : localExpense.item_count) === 1 ? 'item' : 'items'}
            </Text>
            <Ionicons name={itemsExpanded ? 'chevron-up' : 'chevron-down'} size={12} color="#777" />
          </TouchableOpacity>
        )}

        {itemsExpanded && hasItemDetails && (
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
    alignItems: 'stretch',
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
    alignItems: 'flex-start',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  merchant: {
    fontSize: 15,
    color: '#f5f5f5',
    fontWeight: '500',
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  dateInline: {
    flexShrink: 0,
    fontSize: 12,
    color: '#7c7c7c',
  },
  rightCol: {
    alignItems: 'flex-end',
    minWidth: 84,
  },
  detailChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginRight: 6,
  },
  categoryChipInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '72%',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryChipInlineActive: {
    borderColor: '#333',
  },
  categoryChipInlineStatic: {
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
    color: '#7c7c7c',
  },
  locationMetaText: {
    fontSize: 12,
    color: '#7c7c7c',
    marginTop: 4,
  },
  metaDivider: {
    fontSize: 12,
    color: '#4d4d4d',
  },
  ownerChip: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#202020',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  ownerChipOwn: {
    backgroundColor: '#1a2230',
    borderColor: '#26314a',
  },
  ownerChipText: {
    color: '#9f9f9f',
    fontSize: 10,
    fontWeight: '600',
  },
  ownerChipTextOwn: {
    color: '#cfe0ff',
  },
  privateLabel: {
    color: '#6f6f6f',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  amount: {
    fontSize: 15,
    color: '#f5f5f5',
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'right',
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
    paddingTop: 4,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#181818',
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
    color: '#787878',
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
