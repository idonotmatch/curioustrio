import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useExpenses } from '../../hooks/useExpenses';
import { useHouseholdExpenses } from '../../hooks/useHouseholdExpenses';
import { useBudget } from '../../hooks/useBudget';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useHousehold } from '../../hooks/useHousehold';
import { ExpenseItem } from '../../components/ExpenseItem';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getPastMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function SpendHeader({ total, budget, month, mode, onMonthPress }) {
  const limit = budget?.total?.limit;
  const pct = limit ? Math.min(total / limit, 1) : null;
  const over = limit && total > limit;
  const monthName = MONTH_NAMES[month.getMonth()];

  return (
    <View style={styles.spendHeader}>
      <View style={styles.spendRow}>
        <TouchableOpacity onPress={onMonthPress}>
          <Text style={styles.spendMonth}>{monthName} {month.getFullYear()}{mode === 'household' ? ' · Household' : ''}</Text>
        </TouchableOpacity>
        <Text style={styles.spendAmount}>${total.toFixed(0)}</Text>
      </View>
      {pct !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: over ? '#ef4444' : '#4ade80' }]} />
        </View>
      )}
      {limit && (
        <Text style={styles.spendSub}>
          {over
            ? `$${(total - limit).toFixed(0)} over budget`
            : `$${(limit - total).toFixed(0)} remaining of $${limit.toFixed(0)}`}
        </Text>
      )}
    </View>
  );
}

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('mine');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const { memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const { expenses: myExpenses, loading: myLoading, refresh: refreshMine } = useExpenses(selectedMonth);
  const { expenses: householdExpenses, loading: householdLoading, refresh: refreshHousehold } = useHouseholdExpenses(selectedMonth);
  const { budget, refresh: refreshBudget } = useBudget(selectedMonth);
  const { expenses: pending, refresh: refreshPending } = usePendingExpenses();
  const router = useRouter();

  const expenses = mode === 'mine' ? myExpenses : householdExpenses;
  const loading = mode === 'mine' ? myLoading : householdLoading;

  const [displayExpenses, setDisplayExpenses] = useState([]);
  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);

  const refresh = useCallback(() => {
    refreshMine();
    refreshHousehold();
    refreshBudget();
    refreshPending();
  }, [refreshMine, refreshHousehold, refreshBudget, refreshPending]);

  const handleDelete = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  const selectedDate = new Date(selectedMonth + '-02');
  // Server already filtered by selectedMonth — sum all returned expenses
  const monthlyTotal = displayExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const listData = [
    ...(mode === 'mine' && pending?.length > 0 ? [{ _type: 'pending_section', items: pending }] : []),
    ...displayExpenses.map(e => ({ _type: 'expense', ...e })),
  ];

  const renderItem = ({ item }) => {
    if (item._type === 'pending_section') {
      return (
        <View style={styles.pendingSection}>
          <Text style={styles.pendingLabel}>Needs review · {item.items.length}</Text>
          {item.items.slice(0, 3).map(e => (
            <ExpenseItem key={e.id} expense={e} onDelete={refreshPending} />
          ))}
          {item.items.length > 3 && (
            <Text style={styles.pendingMore}>+{item.items.length - 3} more</Text>
          )}
        </View>
      );
    }
    return <ExpenseItem expense={item} onDelete={handleDelete} showUser={mode === 'household'} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Mine / Household toggle — only shown for multi-member households */}
      {isMultiMember && (
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
      )}

      <SpendHeader
        total={monthlyTotal}
        budget={budget}
        month={selectedDate}
        mode={mode}
        onMonthPress={() => setShowMonthPicker(true)}
      />

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.id || `section-${i}`}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No expenses yet. Tap + to get started.</Text>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(tabs)/add')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

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
                  {MONTH_NAMES_FULL[new Date(m + '-02').getMonth()]} {new Date(m + '-02').getFullYear()}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.monthPickerClose} onPress={() => setShowMonthPicker(false)}>
              <Text style={styles.monthPickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  toggleRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  toggleChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  toggleChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  toggleText: { fontSize: 14, color: '#999', fontWeight: '500' },
  toggleTextActive: { color: '#000' },

  spendHeader: { padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  spendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  spendMonth: { fontSize: 13, color: '#888', letterSpacing: 0.3 },
  spendAmount: { fontSize: 26, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.5 },
  barTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1, marginBottom: 6 },
  barFill: { height: 2, borderRadius: 1 },
  spendSub: { fontSize: 13, color: '#888' },

  list: { padding: 16 },
  empty: { color: '#999', textAlign: 'center', marginTop: 40, fontSize: 15 },

  pendingSection: { backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1f1f1f' },
  pendingLabel: { fontSize: 12, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: '600' },
  pendingMore: { color: '#888', fontSize: 14, marginTop: 4, textAlign: 'center' },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  fabText: { fontSize: 28, color: '#000', lineHeight: 32, fontWeight: '300' },

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
