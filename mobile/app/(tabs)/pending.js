import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePendingExpenses, removePendingExpense } from '../../hooks/usePendingExpenses';
import { DuplicateAlert } from '../../components/DuplicateAlert';
import { api } from '../../services/api';
import { invalidateCache, invalidateCacheByPrefix } from '../../services/cache';
import { removeExpenseSnapshot, saveExpenseSnapshot } from '../../services/expenseLocalStore';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function reviewModePresentation(hint = {}) {
  const mode = hint?.review_mode || 'full_review';
  if (mode === 'quick_check') {
    return {
      chipLabel: 'Quick check',
      guidance: 'Check merchant, amount, and date.',
      approveLabel: 'Quick approve',
      accent: styles.modeChipQuick,
      accentText: styles.modeChipTextQuick,
    };
  }
  if (mode === 'items_first') {
    return {
      chipLabel: 'Items first',
      guidance: 'Review extracted items before approving.',
      approveLabel: 'Check items',
      accent: styles.modeChipItems,
      accentText: styles.modeChipTextItems,
    };
  }
  return {
    chipLabel: 'Review',
    guidance: 'Check merchant, date, and category.',
    approveLabel: 'Approve',
    accent: styles.modeChipFull,
    accentText: styles.modeChipTextFull,
  };
}

function pendingSourcePresentation(item = {}) {
  if (item?.review_source === 'gmail' || item?.source === 'email') {
    return {
      label: 'Gmail import',
      icon: 'mail-outline',
      accent: styles.sourceChipEmail,
      accentText: styles.sourceChipTextEmail,
    };
  }
  return {
    label: 'Pending',
    icon: 'time-outline',
    accent: styles.sourceChipDefault,
    accentText: styles.sourceChipTextDefault,
  };
}

function isQuickCheckPending(item = {}) {
  if (item?.gmail_review_hint?.review_mode !== 'quick_check') return false;
  if (Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0) return false;
  const likelyChangedFields = Array.isArray(item?.gmail_review_hint?.likely_changed_fields)
    ? item.gmail_review_hint.likely_changed_fields.filter(Boolean)
    : [];
  return likelyChangedFields.length <= 1;
}

export default function PendingScreen() {
  const router = useRouter();
  const { expenses, loading, error, refresh, isUsingMockData, resolveMockExpense } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);

  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);

  const remove = (id) => {
    setDisplayExpenses(prev => prev.filter(e => e.id !== id));
    removePendingExpense(id);
  };

  async function dismiss(id) {
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      return;
    }
    try {
      await api.post(`/expenses/${id}/dismiss`);
      await removeExpenseSnapshot(id);
      await invalidateCache('cache:expenses:pending');
      remove(id);
    } catch { /* ignore */ }
  }

  async function approve(id) {
    if (isUsingMockData) {
      resolveMockExpense(id);
      remove(id);
      return;
    }
    try {
      const item = displayExpenses.find((entry) => entry.id === id);
      const reviewContext = item?.gmail_review_hint?.review_mode === 'quick_check'
        ? 'quick_check'
        : null;
      const approved = await api.post(`/expenses/${id}/approve`, reviewContext ? { review_context: reviewContext } : {});
      if (approved?.id) await saveExpenseSnapshot(approved);
      await Promise.all([
        invalidateCache('cache:expenses:pending'),
        invalidateCacheByPrefix('cache:expenses:'),
        invalidateCacheByPrefix('cache:budget:'),
        invalidateCacheByPrefix('cache:household-expenses:'),
      ]);
      remove(id);
    } catch { /* ignore */ }
  }

  function renderRightActions(id) {
    return (
      <TouchableOpacity style={styles.dismissAction} onPress={() => dismiss(id)}>
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.actionLabel}>Dismiss</Text>
      </TouchableOpacity>
    );
  }

  function renderLeftActions(item) {
    const mode = reviewModePresentation(item.gmail_review_hint);
    return (
      <TouchableOpacity style={styles.approveAction} onPress={() => approve(item.id)}>
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.actionLabel}>{mode.approveLabel}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
    <View style={styles.container}>
      <FlatList
        data={displayExpenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View>
            <Swipeable
              renderRightActions={() => renderRightActions(item.id)}
              renderLeftActions={() => renderLeftActions(item)}
              overshootLeft={false}
              overshootRight={false}
            >
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push({
                  pathname: '/expense/[id]',
                  params: {
                    id: item.id,
                    expense: JSON.stringify(item),
                  },
                })}
                activeOpacity={0.85}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.merchant} numberOfLines={1}>
                    {item.merchant || item.description || '—'}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.date}>{formatDate(item.date)}</Text>
                    <View style={[styles.sourceChip, pendingSourcePresentation(item).accent]}>
                      <Ionicons
                        name={pendingSourcePresentation(item).icon}
                        size={11}
                        color={pendingSourcePresentation(item).accentText.color}
                      />
                      <Text style={[styles.sourceChipText, pendingSourcePresentation(item).accentText]}>
                        {pendingSourcePresentation(item).label}
                      </Text>
                    </View>
                  </View>
                  {item.gmail_review_hint?.message_subject ? (
                    <Text style={styles.emailSubject} numberOfLines={1}>
                      {item.gmail_review_hint.message_subject}
                    </Text>
                  ) : null}
                  {item.gmail_review_hint ? (
                    (() => {
                      const mode = reviewModePresentation(item.gmail_review_hint);
                      return (
                    <View style={styles.hintWrap}>
                      <View style={styles.hintChipRow}>
                        <View style={[styles.modeChip, mode.accent]}>
                          <Text style={[styles.modeChipText, mode.accentText]}>{mode.chipLabel}</Text>
                        </View>
                      </View>
                      <Text style={styles.hintDetail} numberOfLines={1}>
                        {mode.guidance}
                      </Text>
                    </View>
                      );
                    })()
                  ) : null}
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.amount}>${Number(item.amount).toFixed(2)}</Text>
                  {isQuickCheckPending(item) ? (
                    <TouchableOpacity
                      style={styles.confirmChip}
                      onPress={(event) => {
                        event.stopPropagation?.();
                        approve(item.id);
                      }}
                      activeOpacity={0.82}
                    >
                      <Text style={styles.confirmChipText}>Confirm</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </TouchableOpacity>
            </Swipeable>
            {item.duplicate_flags?.length > 0 && (
              <DuplicateAlert flags={item.duplicate_flags} onDismiss={() => dismiss(item.id)} />
            )}
          </View>
        )}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (typeof router.canGoBack === 'function' && router.canGoBack()) {
                  router.back();
                  return;
                }
                router.replace('/(tabs)');
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-back" size={20} color="#0A84FF" />
              <Text style={styles.backButtonText}>All transactions</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Your review queue</Text>
            <Text style={styles.subtitle}>
              Confirm your Gmail imports before they are counted.
            </Text>
            {displayExpenses.length > 0 ? (
              <Text style={styles.hint}>
                {isUsingMockData ? 'Dev preview queue' : '← Approve · Dismiss →'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading && (
            error
              ? <Text style={styles.error}>{error}</Text>
              : <Text style={styles.empty}>Nothing in your review queue. You're all caught up!</Text>
          )
        }
      />
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  header: {
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 8,
    backgroundColor: '#0a0a0a',
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 12,
    marginLeft: -4,
  },
  backButtonText: { color: '#0A84FF', fontSize: 17, fontWeight: '400' },
  title: { fontSize: 24, color: '#f5f5f5', fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#8a8a8a', marginBottom: 10 },
  hint: { fontSize: 12, color: '#444', textAlign: 'center', letterSpacing: 0.3 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },
  error: { color: '#fca5a5', textAlign: 'center', marginTop: 40, lineHeight: 20 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a',
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  rowMain: { flex: 1, marginRight: 12 },
  merchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  date: { fontSize: 13, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  emailSubject: { marginTop: 6, fontSize: 12, color: '#737373' },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  sourceChipDefault: { backgroundColor: 'rgba(148,163,184,0.08)', borderColor: 'rgba(148,163,184,0.24)' },
  sourceChipEmail: { backgroundColor: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.3)' },
  sourceChipText: { fontSize: 11, fontWeight: '700' },
  sourceChipTextDefault: { color: '#cbd5e1' },
  sourceChipTextEmail: { color: '#93c5fd' },
  hintWrap: { marginTop: 6, gap: 4 },
  hintChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  modeChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  modeChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  modeChipQuick: { backgroundColor: 'rgba(134,239,172,0.08)', borderColor: 'rgba(134,239,172,0.35)' },
  modeChipTextQuick: { color: '#bbf7d0' },
  modeChipItems: { backgroundColor: 'rgba(253,224,71,0.08)', borderColor: 'rgba(253,224,71,0.35)' },
  modeChipTextItems: { color: '#fde68a' },
  modeChipFull: { backgroundColor: 'rgba(147,197,253,0.08)', borderColor: 'rgba(147,197,253,0.28)' },
  modeChipTextFull: { color: '#bfdbfe' },
  hintDetail: { fontSize: 12, color: '#8a8a8a' },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  amount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },
  confirmChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.3)',
    backgroundColor: 'rgba(134,239,172,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  confirmChipText: { fontSize: 11, fontWeight: '700', color: '#bbf7d0' },

  approveAction: {
    backgroundColor: '#22c55e',
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  dismissAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  actionLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
