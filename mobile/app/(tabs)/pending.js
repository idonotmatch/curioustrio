import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { DuplicateAlert } from '../../components/DuplicateAlert';
import { api } from '../../services/api';
import { invalidateCache, invalidateCacheByPrefix } from '../../services/cache';

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

function formatFieldList(fields = []) {
  if (!Array.isArray(fields) || !fields.length) return '';
  return fields
    .slice(0, 3)
    .map((field) => `${field}`.replace(/_/g, ' '))
    .join(', ');
}

function reviewToneStyle(tone) {
  switch (tone) {
    case 'positive': return { chip: styles.hintChipPositive, text: styles.hintChipTextPositive };
    case 'warning': return { chip: styles.hintChipWarning, text: styles.hintChipTextWarning };
    case 'caution': return { chip: styles.hintChipCaution, text: styles.hintChipTextCaution };
    default: return { chip: styles.hintChipInfo, text: styles.hintChipTextInfo };
  }
}

export default function PendingScreen() {
  const router = useRouter();
  const { expenses, loading, refresh } = usePendingExpenses();
  const [displayExpenses, setDisplayExpenses] = useState(expenses);

  useEffect(() => { setDisplayExpenses(expenses); }, [expenses]);

  const remove = (id) => setDisplayExpenses(prev => prev.filter(e => e.id !== id));

  async function dismiss(id) {
    try {
      await api.post(`/expenses/${id}/dismiss`);
      await invalidateCache('cache:expenses:pending');
      remove(id);
    } catch { /* ignore */ }
  }

  async function approve(id) {
    try {
      await api.post(`/expenses/${id}/approve`);
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

  function renderLeftActions(id) {
    return (
      <TouchableOpacity style={styles.approveAction} onPress={() => approve(id)}>
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.actionLabel}>Approve</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={displayExpenses}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View>
            <Swipeable
              renderRightActions={() => renderRightActions(item.id)}
              renderLeftActions={() => renderLeftActions(item.id)}
              overshootLeft={false}
              overshootRight={false}
            >
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push(`/expense/${item.id}`)}
                activeOpacity={0.85}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.merchant} numberOfLines={1}>
                    {item.merchant || item.description || '—'}
                  </Text>
                  <Text style={styles.date}>{formatDate(item.date)}</Text>
                  {item.gmail_review_hint ? (
                    <View style={styles.hintWrap}>
                      <View style={[styles.hintChip, reviewToneStyle(item.gmail_review_hint.tone).chip]}>
                        <Text style={[styles.hintChipText, reviewToneStyle(item.gmail_review_hint.tone).text]}>
                          {item.gmail_review_hint.headline}
                        </Text>
                      </View>
                      {item.gmail_review_hint.likely_changed_fields?.length ? (
                        <Text style={styles.hintDetail} numberOfLines={1}>
                          Usually worth checking {formatFieldList(item.gmail_review_hint.likely_changed_fields)}.
                        </Text>
                      ) : (
                        <Text style={styles.hintDetail} numberOfLines={1}>
                          {item.gmail_review_hint.message}
                        </Text>
                      )}
                    </View>
                  ) : null}
                </View>
                <Text style={styles.amount}>${Number(item.amount).toFixed(2)}</Text>
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
          displayExpenses.length > 0 ? (
            <Text style={styles.hint}>← Approve · Dismiss →</Text>
          ) : null
        }
        ListEmptyComponent={
          !loading && <Text style={styles.empty}>No pending expenses. You're all caught up!</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  list: { padding: 16 },
  hint: { fontSize: 12, color: '#444', textAlign: 'center', marginBottom: 12, letterSpacing: 0.3 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a',
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  rowMain: { flex: 1, marginRight: 12 },
  merchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  date: { fontSize: 13, color: '#666', marginTop: 2 },
  hintWrap: { marginTop: 6, gap: 4 },
  hintChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  hintChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  hintChipPositive: { backgroundColor: 'rgba(34,197,94,0.14)' },
  hintChipTextPositive: { color: '#86efac' },
  hintChipWarning: { backgroundColor: 'rgba(248,113,113,0.14)' },
  hintChipTextWarning: { color: '#fca5a5' },
  hintChipCaution: { backgroundColor: 'rgba(245,158,11,0.16)' },
  hintChipTextCaution: { color: '#fcd34d' },
  hintChipInfo: { backgroundColor: 'rgba(96,165,250,0.14)' },
  hintChipTextInfo: { color: '#93c5fd' },
  hintDetail: { fontSize: 12, color: '#8a8a8a' },
  amount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },

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
