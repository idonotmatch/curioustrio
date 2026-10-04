import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { memo, useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { loadExpenseItemsSnapshot, patchExpenseInCachedLists, removeExpenseFromCachedLists, saveExpenseSnapshot, removeExpenseSnapshot } from '../services/expenseLocalStore';
import { invalidateExpenseMutationCaches } from '../services/expenseMutationEffects';
import { colors, mutedCategoryColor, radius, spacing } from '../theme/tokens';

const ITEM_CACHE_FRESH_MS = 10 * 60 * 1000;

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

function summarizeItemSignals(items = []) {
  return items.reduce((summary, item) => {
    if (item.product_id) summary.matched += 1;
    if (item.estimated_unit_price != null) summary.unitPriced += 1;
    if (item.item_type && item.item_type !== 'product') summary.nonProduct += 1;
    return summary;
  }, { matched: 0, unitPriced: 0, nonProduct: 0 });
}

function itemSignalChips(items = []) {
  const summary = summarizeItemSignals(items);
  const chips = [];
  if (summary.matched > 0) {
    chips.push({ key: 'matched', label: `${summary.matched} matched`, tone: 'positive' });
  }
  if (summary.unitPriced > 0) {
    chips.push({ key: 'unit', label: 'unit pricing', tone: 'info' });
  }
  if (summary.nonProduct > 0) {
    chips.push({ key: 'extras', label: `${summary.nonProduct} fees/extras`, tone: 'muted' });
  }
  return chips;
}

function formatItemMeta(item = {}) {
  return [item.brand, item.product_size || item.pack_size].filter(Boolean).join(' • ') || null;
}

export const ExpenseItem = memo(function ExpenseItem({
  expense,
  categories = [],
  currentUserId = null,
  showUser = false,
  onDelete,
  pending = false,
}) {
  const router = useRouter();
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
  const color = mutedCategoryColor(localExpense.category_name);
  const isRefund = Number(localExpense.amount) < 0;
  const merchantTitle = localExpense.merchant || localExpense.description || 'Expense';
  const categoryLabel = localExpense.category_parent_name || localExpense.category_name || 'Uncategorized';
  const locationLabel = deriveLocationLabel(localExpense);
  const ownerLabel = isOwn ? 'You' : (localExpense.user_name || 'Household member');
  const categoryOptions = categories.filter(c => !c.parent_id || c.parent_name);
  const dateLabel = formatDate(localExpense.date);
  const hasItemDetails = Array.isArray(localExpense.items)
    ? localExpense.items.length > 0
    : Number(localExpense.item_count) > 0;
  const previewItems = Array.isArray(localExpense.items) ? localExpense.items : [];
  const previewItemChips = itemSignalChips(previewItems).slice(0, 2);

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
      const cached = await loadExpenseItemsSnapshot(localExpense.id, {
        maxAgeMs: ITEM_CACHE_FRESH_MS,
        includeMeta: true,
      });
      if (cached?.items) {
        setItems(cached.items);
        setItemsLoading(false);
        if (cached.isFresh) {
          return;
        }
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
      setLocalExpense(prev => ({
        ...prev,
        category_id: category.id,
        category_name: category.name,
        category_parent_name: category.parent_name || null,
      }));
      const updatedExpense = {
        ...localExpense,
        category_id: category.id,
        category_name: category.name,
        category_parent_name: category.parent_name || null,
      };
      saveExpenseSnapshot(updatedExpense);
      patchExpenseInCachedLists(updatedExpense);
      await invalidateExpenseMutationCaches();
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
          await removeExpenseFromCachedLists(localExpense.id);
          await removeExpenseSnapshot(localExpense.id);
          await invalidateExpenseMutationCaches();
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
          <View style={[styles.accent, { backgroundColor: pending ? colors.warning : color }]} />
          <View style={styles.left}>
            <View style={styles.headerRow}>
              <View style={styles.titleWrap}>
                <View style={styles.titleRow}>
                  <Text style={styles.merchant} numberOfLines={1}>{merchantTitle}</Text>
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
                    <ActivityIndicator size="small" color={colors.textDisabled} style={styles.categorySpinner} />
                  ) : (
                    <Ionicons
                      name={categoryPickerOpen ? 'chevron-up' : 'chevron-down'}
                      size={11}
                      color={colors.textDisabled}
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
              {localExpense.exclude_from_budget ? (
                <View style={styles.trackOnlyChip}>
                  <Text style={styles.trackOnlyChipText}>Track only</Text>
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
            <View style={styles.itemToggleText}>
              <Text style={styles.itemCount}>
                {Array.isArray(localExpense.items) ? localExpense.items.length : localExpense.item_count} {(Array.isArray(localExpense.items) ? localExpense.items.length : localExpense.item_count) === 1 ? 'item' : 'items'}
              </Text>
              {previewItemChips.length > 0 ? (
                <View style={styles.itemSignalRow}>
                  {previewItemChips.map((chip) => (
                    <View
                      key={chip.key}
                      style={[
                        styles.itemSignalChip,
                        chip.tone === 'positive' && styles.itemSignalChipPositive,
                        chip.tone === 'info' && styles.itemSignalChipInfo,
                      ]}
                    >
                      <Text
                        style={[
                          styles.itemSignalChipText,
                          chip.tone === 'positive' && styles.itemSignalChipTextPositive,
                          chip.tone === 'info' && styles.itemSignalChipTextInfo,
                        ]}
                      >
                        {chip.label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <Ionicons name={itemsExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textDisabled} />
          </TouchableOpacity>
        )}

        {itemsExpanded && hasItemDetails && (
          <View style={styles.itemsPanel}>
            {itemsLoading ? (
              <ActivityIndicator size="small" color={colors.textDisabled} style={{ paddingVertical: 8 }} />
            ) : items?.length ? (
              <>
                {items.slice(0, 5).map((item, index) => (
                  <View key={`${localExpense.id}-${index}`} style={styles.itemRow}>
                    <View style={styles.itemText}>
                      <Text style={styles.itemName} numberOfLines={1}>{item.description}</Text>
                      {formatItemMeta(item) ? <Text style={styles.itemMeta} numberOfLines={1}>{formatItemMeta(item)}</Text> : null}
                    </View>
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
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: 6,
    overflow: 'hidden',
  },
  rowPress: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  containerPending: {
    backgroundColor: colors.warningMuted,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
  },
  left: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
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
    color: colors.text,
    fontWeight: '500',
    letterSpacing: -0.2,
    flexShrink: 1,
    minWidth: 0,
  },
  dateInline: {
    flexShrink: 0,
    fontSize: 12,
    color: colors.textSubtle,
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
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryChipInlineActive: {
    borderColor: colors.accentMuted,
  },
  categoryChipInlineStatic: {
    paddingRight: 10,
  },
  categoryChipText: {
    color: colors.text,
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
    color: colors.textSubtle,
  },
  locationMetaText: {
    fontSize: 12,
    color: colors.textSubtle,
    marginTop: 4,
  },
  metaDivider: {
    fontSize: 12,
    color: colors.textDisabled,
  },
  ownerChip: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  ownerChipOwn: {
    backgroundColor: colors.infoMuted,
    borderColor: colors.infoMuted,
  },
  ownerChipText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  ownerChipTextOwn: {
    color: colors.textMuted,
  },
  privateLabel: {
    color: colors.textDisabled,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  trackOnlyChip: {
    backgroundColor: colors.successMuted,
    borderWidth: 1,
    borderColor: colors.successMuted,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  trackOnlyChipText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: '700',
  },
  amount: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
    letterSpacing: -0.3,
    textAlign: 'right',
  },
  amountRefund: {
    color: colors.success,
  },
  categoryPicker: {
    marginLeft: 3,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  categoryPickerContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  categoryOptionChip: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryOptionChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryOptionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  categoryOptionTextActive: {
    color: colors.textInverse,
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
    borderTopColor: colors.borderSubtle,
  },
  itemToggleText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    borderRadius: radius.md,
    marginBottom: 6,
  },
  deleteText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  itemCount: {
    fontSize: 12,
    color: colors.textSubtle,
  },
  itemSignalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemSignalChip: {
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  itemSignalChipPositive: {
    backgroundColor: colors.successMuted,
  },
  itemSignalChipInfo: {
    backgroundColor: colors.infoMuted,
  },
  itemSignalChipText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  itemSignalChipTextPositive: {
    color: colors.success,
  },
  itemSignalChipTextInfo: {
    color: colors.info,
  },
  itemsPanel: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
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
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
  },
  itemMeta: {
    color: colors.textSubtle,
    fontSize: 11,
    marginTop: 2,
  },
  itemAmount: {
    color: colors.textMuted,
    fontSize: 12,
  },
  itemEmpty: {
    color: colors.textSubtle,
    fontSize: 12,
  },
  itemMore: {
    color: colors.textSubtle,
    fontSize: 12,
    marginTop: 4,
  },
});
