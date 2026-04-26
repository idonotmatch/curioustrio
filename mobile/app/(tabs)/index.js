import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Modal, LayoutAnimation, UIManager, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMonth, periodLabel, currentPeriod } from '../../contexts/MonthContext';
import { Ionicons } from '@expo/vector-icons';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { usePendingExpenses, removePendingExpense } from '../../hooks/usePendingExpenses';
import { useHousehold } from '../../hooks/useHousehold';
import { useCategories } from '../../hooks/useCategories';
import { ActionNotice } from '../../components/ActionNotice';
import { DismissReasonSheet } from '../../components/DismissReasonSheet';
import { ExpenseItem } from '../../components/ExpenseItem';
import { GlobalAddLauncher } from '../../components/GlobalAddLauncher';
import { ReviewQueueItem } from '../../components/ReviewQueueItem';
import { api } from '../../services/api';
import { GlobalPeriodHeader } from '../../components/GlobalPeriodHeader';
import { patchExpenseInCachedLists, removeExpenseFromCachedLists, removeExpenseSnapshot, saveExpenseSnapshot } from '../../services/expenseLocalStore';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'amount', label: 'Amount' },
  { key: 'category', label: 'Category' },
  { key: 'user', label: 'User' },
  { key: 'merchant', label: 'Merchant' },
];

function compareText(a, b) {
  return `${a || ''}`.localeCompare(`${b || ''}`, undefined, { sensitivity: 'base' });
}

function compareNewest(a, b) {
  const dateCompare = `${b?.date || ''}`.localeCompare(`${a?.date || ''}`);
  if (dateCompare !== 0) return dateCompare;
  return `${b?.created_at || ''}`.localeCompare(`${a?.created_at || ''}`);
}

function sortExpenses(expenses = [], sortKey = 'newest') {
  const list = [...expenses];
  switch (sortKey) {
    case 'amount':
      return list.sort((a, b) => {
        const diff = Math.abs(Number(b?.amount || 0)) - Math.abs(Number(a?.amount || 0));
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'category':
      return list.sort((a, b) => {
        const diff = compareText(a?.category_parent_name || a?.category_name || 'Uncategorized', b?.category_parent_name || b?.category_name || 'Uncategorized');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'user':
      return list.sort((a, b) => {
        const diff = compareText(a?.user_name || 'You', b?.user_name || 'You');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'merchant':
      return list.sort((a, b) => {
        const diff = compareText(a?.merchant || a?.description || '', b?.merchant || b?.description || '');
        if (diff !== 0) return diff;
        return compareNewest(a, b);
      });
    case 'newest':
    default:
      return list.sort(compareNewest);
  }
}

function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function BudgetBar({ spent, budget, label, periodText }) {
  const [expanded, setExpanded] = useState(false);
  const limit = budget?.total?.limit;
  const pct = limit ? Math.min(spent / limit, 1) : null;
  const hasLimit = Number(limit) > 0;
  const over = hasLimit && spent > limit;
  const byParent = budget?.by_parent;
  const hasBreakdown = Array.isArray(byParent) && byParent.length > 0;

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  }

  return (
    <View style={styles.budgetSection}>
      <TouchableOpacity
        style={styles.budgetRow}
        onPress={hasBreakdown ? toggle : undefined}
        activeOpacity={hasBreakdown ? 0.7 : 1}
      >
        <View style={styles.budgetLabelRow}>
          <Text style={styles.budgetLabel}>{label}</Text>
          {periodText ? <Text style={styles.budgetPeriod}> · {periodText}</Text> : null}
          {hasBreakdown && (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={11}
              color="#555"
              style={{ marginLeft: 4, marginTop: 1 }}
            />
          )}
        </View>
        <Text style={styles.budgetAmount}>${spent.toFixed(0)}</Text>
      </TouchableOpacity>
      {pct !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? '#ef4444' : '#4ade80' }]} />
        </View>
      )}
      {hasLimit && (
        <Text style={styles.spendSub}>
          {over
            ? `$${(spent - limit).toFixed(0)} over budget`
            : `$${(limit - spent).toFixed(0)} remaining of $${limit.toFixed(0)}`}
        </Text>
      )}
      {expanded && hasBreakdown && (
        <View style={styles.byParentList}>
          {byParent
            .filter(p => p.spent > 0)
            .sort((a, b) => b.spent - a.spent)
            .map(p => (
              <View key={p.group_id} style={styles.byParentRow}>
                <Text style={styles.byParentName} numberOfLines={1}>{p.name}</Text>
                <View style={styles.byParentRight}>
                  <Text style={styles.byParentSpent}>${p.spent.toFixed(0)}</Text>
                  {p.limit != null && (
                    <Text style={styles.byParentLimit}> / ${p.limit.toFixed(0)}</Text>
                  )}
                </View>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

function SpendHeader({ myBudget, householdBudget, isMultiMember, selectedMonth, transactionStartDay, onMonthPress, householdName }) {
  return (
    <View style={styles.spendHeader}>
      <GlobalPeriodHeader
        periodText={periodLabel(selectedMonth, transactionStartDay)}
        householdName={householdName}
        onPress={onMonthPress}
        style={styles.globalHeader}
      />
      <BudgetBar spent={Number(myBudget?.total?.spent || 0)} budget={myBudget} label="Mine" />
      {isMultiMember && householdBudget && (
        <BudgetBar spent={Number(householdBudget?.total?.spent || 0)} budget={householdBudget} label="Household" />
      )}
    </View>
  );
}

function pendingModeSummary(expenses = []) {
  const counts = { quickCheck: 0, itemsFirst: 0, review: 0 };
  for (const expense of expenses) {
    const mode = expense?.gmail_review_hint?.review_mode;
    if (mode === 'quick_check') counts.quickCheck += 1;
    else if (mode === 'items_first') counts.itemsFirst += 1;
    else counts.review += 1;
  }

  return [
    counts.quickCheck > 0 ? `${counts.quickCheck} quick check` : null,
    counts.itemsFirst > 0 ? `${counts.itemsFirst} items first` : null,
    counts.review > 0 ? `${counts.review} review` : null,
  ].filter(Boolean).join(' · ');
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('mine');
  const [sortKey, setSortKey] = useState('newest');
  const { startDay } = useMonth();
  const { household, memberCount, refresh: refreshHousehold } = useHousehold();
  const householdStartDay = household?.budget_start_day || 1;
  const isMultiMember = memberCount > 1;
  const transactionStartDay = isMultiMember ? householdStartDay : startDay;
  const [selectedMonth, setSelectedMonth] = useState(() => currentPeriod(transactionStartDay));
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showSortPicker, setShowSortPicker] = useState(false);
  const { expenses: myExpenses, loading: myLoading, error: myError, refresh: refreshMine } = useExpenses(selectedMonth, transactionStartDay);
  const { expenses: householdExpenses, loading: householdLoading, error: householdError, refresh: refreshHouseholdExpenses } = useHouseholdExpenses(selectedMonth, transactionStartDay, { enabled: isMultiMember });
  const { budget: personalBudget, error: personalBudgetError, refresh: refreshPersonalBudget } = useBudget(selectedMonth, 'personal', { startDayOverride: transactionStartDay });
  const { budget: householdBudget, error: householdBudgetError, refresh: refreshHouseholdBudget } = useBudget(selectedMonth, 'household', { startDayOverride: transactionStartDay, enabled: isMultiMember });
  const { expenses: pending, error: pendingError, refresh: refreshPending, isUsingMockData: isUsingMockPending, resolveMockExpense } = usePendingExpenses();
  const { categories } = useCategories();
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [dismissingId, setDismissingId] = useState(null);

  useEffect(() => {
    setSelectedMonth(currentPeriod(transactionStartDay));
  }, [transactionStartDay]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  const expenses = mode === 'mine' ? myExpenses : householdExpenses;
  const loading = mode === 'mine' ? myLoading : householdLoading;
  const expenseError = mode === 'mine' ? myError : householdError;
  const budgetError = mode === 'mine' ? personalBudgetError : householdBudgetError;
  const currentSortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label || 'Newest';

  const [displayExpenses, setDisplayExpenses] = useState([]);
  useEffect(() => { setDisplayExpenses(sortExpenses(expenses, sortKey)); }, [expenses, sortKey]);

  const refresh = useCallback(() => {
    refreshMine();
    if (isMultiMember) refreshHouseholdExpenses();
    refreshPersonalBudget();
    if (isMultiMember) refreshHouseholdBudget();
    refreshPending();
    refreshHousehold();
  }, [refreshMine, refreshHouseholdExpenses, refreshPersonalBudget, refreshHouseholdBudget, refreshPending, refreshHousehold, isMultiMember]);

  useFocusEffect(useCallback(() => {
    if (isMultiMember) refreshHouseholdExpenses();
    if (isMultiMember) refreshHouseholdBudget();
    refreshPersonalBudget();
    refreshPending();
  }, [refreshHouseholdExpenses, refreshHouseholdBudget, refreshPersonalBudget, refreshPending, isMultiMember]));

  function requestDismissPending(id) {
    setDismissingId(id);
  }

  async function dismissPending(id, dismissalReason) {
    if (isUsingMockPending) {
      resolveMockExpense(id);
      setDismissingId(null);
      setNotice('Dismissed from your review queue');
      return;
    }
    try {
      await api.post(`/expenses/${id}/dismiss`, { dismissal_reason: dismissalReason });
      await removeExpenseFromCachedLists(id);
      await removeExpenseSnapshot(id);
      removePendingExpense(id);
      setDismissingId(null);
      setNotice('Dismissed from your review queue');
      const { invalidateCache } = await import('../../services/cache');
      await invalidateCache('cache:expenses:pending');
    } catch { /* ignore */ }
  }

  async function approvePending(id) {
    if (isUsingMockPending) {
      resolveMockExpense(id);
      setNotice('Approved and added to your expenses');
      return;
    }
    try {
      const approved = await api.post(`/expenses/${id}/approve`);
      if (approved?.id) {
        await saveExpenseSnapshot(approved);
        await patchExpenseInCachedLists(approved);
      }
      removePendingExpense(id);
      setNotice('Approved and added to your expenses');
      const { invalidateCache, invalidateCacheByPrefix } = await import('../../services/cache');
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      refreshMine();
      refreshHouseholdExpenses();
      refreshPersonalBudget();
      refreshHouseholdBudget();
    } catch { /* ignore */ }
  }

  const handleDelete = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  const selectedDate = new Date(selectedMonth + '-02');
  const listData = [
    { _type: 'pending_section', items: pending || [] },
    ...displayExpenses.map(e => ({ _type: 'expense', ...e })),
  ];

  const renderItem = ({ item }) => {
    if (item._type === 'pending_section') {
      const modeSummary = pendingModeSummary(item.items);
      return (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingLabel}>Needs your review · {item.items.length}</Text>
          {modeSummary ? (
            <Text style={styles.pendingModeSummary}>{modeSummary}</Text>
          ) : null}
          {isUsingMockPending ? (
            <Text style={styles.pendingPreviewNote}>Dev preview queue</Text>
          ) : null}
          {pendingError ? (
            <View style={styles.pendingErrorState}>
              <Text style={styles.pendingErrorTitle}>Could not load your review queue</Text>
              <Text style={styles.pendingErrorBody}>{pendingError}</Text>
            </View>
          ) : null}
          {!pendingError && item.items.length === 0 ? (
            <View style={styles.pendingEmptyState}>
              <View style={styles.pendingEmptyIconWrap}>
                <Ionicons name="checkmark-done" size={18} color="#d5e5da" />
              </View>
              <View style={styles.pendingEmptyCopy}>
                <Text style={styles.pendingEmptyTitle}>You’re all caught up</Text>
                <Text style={styles.pendingEmptyBody}>New Gmail imports will land here when they need your review.</Text>
              </View>
            </View>
          ) : null}
          {item.items.slice(0, 3).map(e => (
            <ReviewQueueItem
              key={e.id}
              item={e}
              variant="preview"
              onOpen={(entry) => router.push({
                pathname: '/expense/[id]',
                params: {
                  id: entry.id,
                  expense: JSON.stringify(entry),
                },
              })}
              onApprove={approvePending}
              onDismiss={requestDismissPending}
            />
          ))}
          {item.items.length > 3 && (
            <TouchableOpacity
              style={styles.pendingMoreButton}
              onPress={() => router.push('/review-queue')}
              activeOpacity={0.8}
            >
              <Text style={styles.pendingMore}>+{item.items.length - 3} more</Text>
              <Ionicons name="chevron-forward" size={14} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return <ExpenseItem expense={item} categories={categories} onDelete={handleDelete} showUser={mode === 'household'} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SpendHeader
        myBudget={personalBudget}
        householdBudget={householdBudget}
        isMultiMember={isMultiMember}
        selectedMonth={selectedMonth}
        transactionStartDay={transactionStartDay}
        onMonthPress={() => setShowMonthPicker(true)}
        householdName={isMultiMember ? (household?.name || '') : ''}
      />

      {/* Mine / Household toggle — filters the expense list only */}
      <View style={styles.controlsRow}>
      {isMultiMember ? (
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleChip, mode === 'mine' && styles.toggleChipActive]}
            onPress={() => setMode('mine')}
          >
            <Text style={[styles.toggleText, mode === 'mine' && styles.toggleTextActive]}>Mine</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleChip, mode === 'household' && styles.toggleChipActive]}
            onPress={() => setMode('household')}
          >
            <Text style={[styles.toggleText, mode === 'household' && styles.toggleTextActive]}>Household</Text>
          </TouchableOpacity>
        </View>
      ) : <View />}
        <TouchableOpacity style={styles.sortChip} onPress={() => setShowSortPicker(true)}>
          <Ionicons name="swap-vertical-outline" size={13} color="#888" />
          <Text style={styles.sortChipText}>Sort: {currentSortLabel}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.id || `section-${i}`}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          expenseError || budgetError ? (
            <View style={styles.feedErrorState}>
              <Text style={styles.feedErrorTitle}>Could not refresh your transactions</Text>
              <Text style={styles.feedErrorBody}>{expenseError || budgetError}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap + to get started.</Text>
        }
      />

      <GlobalAddLauncher router={router} bottomOffset={24} />

      <Modal visible={showMonthPicker} transparent animationType="slide" onRequestClose={() => setShowMonthPicker(false)}>
        <View style={styles.monthPickerOverlay}>
          <View style={styles.monthPickerSheet}>
            <Text style={styles.monthPickerTitle}>Select month</Text>
            {getPastMonths().map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.monthOption, m === selectedMonth && styles.monthOptionActive]}
                onPress={() => { setSelectedMonth(m); setShowMonthPicker(false); }}
              >
                <Text style={[styles.monthOptionText, m === selectedMonth && styles.monthOptionTextActive]}>
                  {periodLabel(m, transactionStartDay)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowMonthPicker(false)}>
              <Text style={styles.monthPickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showSortPicker} transparent animationType="slide" onRequestClose={() => setShowSortPicker(false)}>
        <View style={styles.monthPickerOverlay}>
          <View style={styles.monthPickerSheet}>
            <Text style={styles.monthPickerTitle}>Sort transactions</Text>
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.monthOption, option.key === sortKey && styles.monthOptionActive]}
                onPress={() => {
                  setSortKey(option.key);
                  setShowSortPicker(false);
                }}
              >
                <Text style={[styles.monthOptionText, option.key === sortKey && styles.monthOptionTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowSortPicker(false)}>
              <Text style={styles.monthPickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <DismissReasonSheet
        visible={!!dismissingId}
        onClose={() => setDismissingId(null)}
        onSelect={(reason) => dismissPending(dismissingId, reason)}
      />
      <ActionNotice message={notice} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 12,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  toggleChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  toggleText: { fontSize: 14, color: '#999', fontWeight: '500' },
  toggleTextActive: { color: '#000' },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
  },
  sortChipText: { fontSize: 13, color: '#999', fontWeight: '500' },

  spendHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#111' },
  globalHeader: { marginBottom: 10 },
  budgetSection: { marginBottom: 12 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  budgetLabelRow: { flexDirection: 'row', alignItems: 'center' },
  budgetLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  budgetPeriod: { fontSize: 11, color: '#555' },
  budgetAmount: { fontSize: 22, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.5 },
  byParentList: { marginTop: 8, gap: 6 },
  byParentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  byParentName: { fontSize: 13, color: '#888', flex: 1, marginRight: 8 },
  byParentRight: { flexDirection: 'row', alignItems: 'baseline' },
  byParentSpent: { fontSize: 13, color: '#ccc', fontWeight: '500' },
  byParentLimit: { fontSize: 11, color: '#555' },
  barTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 4 },
  barFill: { height: 2, borderRadius: 1 },
  spendSub: { fontSize: 12, color: '#666' },

  list: { padding: 16 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40, fontSize: 15 },

  pendingSection: { backgroundColor: '#111', borderRadius: 10, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#1f1f1f' },
  pendingLabel: { fontSize: 12, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: '600', paddingHorizontal: 12, paddingTop: 12 },
  pendingModeSummary: { fontSize: 11, color: '#7f8da4', paddingHorizontal: 12, paddingBottom: 2 },
  pendingPreviewNote: { fontSize: 11, color: '#8ab4ff', paddingHorizontal: 12, paddingBottom: 4 },
  pendingErrorState: { paddingHorizontal: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  pendingErrorTitle: { fontSize: 14, color: '#f5f5f5', fontWeight: '600', marginBottom: 4 },
  pendingErrorBody: { fontSize: 12, color: '#fca5a5', lineHeight: 18 },
  feedErrorState: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#3a1f1f',
    backgroundColor: '#181111',
    borderRadius: 8,
  },
  feedErrorTitle: { fontSize: 14, color: '#f5f5f5', fontWeight: '600', marginBottom: 4 },
  feedErrorBody: { fontSize: 12, color: '#fca5a5', lineHeight: 18 },
  pendingEmptyState: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pendingEmptyIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#102017',
    borderWidth: 1,
    borderColor: '#22372a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingEmptyCopy: { flex: 1, minWidth: 0 },
  pendingEmptyTitle: { fontSize: 13, color: '#f5f5f5', fontWeight: '600', marginBottom: 2 },
  pendingEmptyBody: { fontSize: 11, color: '#8a8a8a', lineHeight: 16 },
  pendingMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  pendingMore: { color: '#888', fontSize: 14, textAlign: 'center' },
  monthPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  monthPickerSheet: { backgroundColor: '#111', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 40 },
  monthPickerTitle: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  monthOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  monthOptionActive: {},
  monthOptionText: { fontSize: 16, color: '#999' },
  monthOptionTextActive: { color: '#f5f5f5', fontWeight: '600' },
  monthPickerClose: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  monthPickerCloseText: { color: '#888', fontSize: 15 },
});
