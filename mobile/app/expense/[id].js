import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { CategoryBadge } from '../../components/CategoryBadge';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    api.get(`/expenses/${id}`)
      .then(setExpense)
      .catch(() => {}) // 404 → stay on loading, let user go back
      .finally(() => setLoading(false));
  }, [id]);

  async function dismiss() {
    setDismissing(true);
    try {
      await api.post(`/expenses/${id}/dismiss`);
      router.back();
    } catch (e) {
      setDismissing(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#fff" /></View>;
  if (!expense) return <View style={styles.center}><Text style={styles.muted}>Expense not found.</Text></View>;

  // Format date: "March 20, 2026"
  const formattedDate = new Date(expense.date + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const sourceLabel = { manual: 'Manual entry', camera: 'Receipt scan', email: 'Email import' };

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: expense.merchant }} />

      <View style={styles.hero}>
        <Text style={styles.merchant}>{expense.merchant}</Text>
        <Text style={styles.amount}>${Number(expense.amount).toFixed(2)}</Text>
      </View>

      <View style={styles.section}>
        <Row label="Date" value={formattedDate} />
        <Row label="Source" value={sourceLabel[expense.source] || expense.source} />
        {expense.place_name && <Row label="Location" value={expense.place_name + (expense.address ? `\n${expense.address}` : '')} />}
        {expense.notes && <Row label="Notes" value={expense.notes} />}
        {expense.category_name && (
          <View style={styles.row}>
            <Text style={styles.label}>Category</Text>
            <CategoryBadge name={expense.category_name} confidence={1} source="memory" />
          </View>
        )}
      </View>

      {expense.duplicate_flags?.length > 0 && (
        <View style={styles.dupSection}>
          <Text style={styles.dupTitle}>⚠ Possible duplicate</Text>
          {expense.duplicate_flags.map(f => (
            <Text key={f.id} style={styles.dupItem}>
              Confidence: {f.confidence} · Status: {f.status}
            </Text>
          ))}
        </View>
      )}

      {expense.status !== 'dismissed' && (
        <TouchableOpacity style={styles.dismissBtn} onPress={dismiss} disabled={dismissing}>
          <Text style={styles.dismissText}>{dismissing ? 'Dismissing…' : 'Dismiss expense'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  hero: { padding: 24, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  merchant: { fontSize: 22, color: '#fff', fontWeight: '700' },
  amount: { fontSize: 36, color: '#fff', fontWeight: '700', marginTop: 4 },
  section: { padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  label: { fontSize: 13, color: '#666', flex: 1 },
  value: { fontSize: 14, color: '#fff', flex: 2, textAlign: 'right' },
  dupSection: { margin: 16, padding: 12, backgroundColor: '#2a1f00', borderRadius: 8 },
  dupTitle: { color: '#ffd060', fontWeight: '600', marginBottom: 6 },
  dupItem: { color: '#ffb84d', fontSize: 12, marginTop: 2 },
  dismissBtn: { margin: 16, padding: 14, backgroundColor: '#1a1a1a', borderRadius: 8, alignItems: 'center' },
  dismissText: { color: '#ff6b6b', fontWeight: '600' },
  muted: { color: '#555' },
});
