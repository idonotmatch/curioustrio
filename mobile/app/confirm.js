import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '../services/api';
import { ConfirmField } from '../components/ConfirmField';
import { CategoryBadge } from '../components/CategoryBadge';

export default function ConfirmScreen() {
  const { data } = useLocalSearchParams();
  const parsed = JSON.parse(data);
  const router = useRouter();

  const [expense, setExpense] = useState(parsed);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!expense.category_id) {
      Alert.alert('Category required', 'Please assign a category before confirming.');
      return;
    }
    try {
      setSaving(true);
      await api.post('/expenses/confirm', {
        merchant: expense.merchant,
        amount: expense.amount,
        date: expense.date,
        category_id: expense.category_id,
        source: 'manual',
        notes: expense.notes,
      });
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ConfirmField label="Merchant" value={expense.merchant} />
      <ConfirmField label="Amount" value={`$${Number(expense.amount).toFixed(2)}`} />
      <ConfirmField label="Date" value={expense.date} />
      <View style={styles.categoryRow}>
        <Text style={styles.categoryLabel}>CATEGORY</Text>
        <CategoryBadge
          name={expense.category_name}
          confidence={expense.category_confidence || 0}
          source={expense.category_source}
        />
      </View>
      {!expense.category_id && (
        <Text style={styles.categoryRequired}>Category required before confirming</Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.discard} onPress={() => router.back()}>
          <Text style={styles.discardText}>discard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirm, saving && styles.confirmDisabled]}
          onPress={handleConfirm}
          disabled={saving}
        >
          <Text style={styles.confirmText}>{saving ? 'saving...' : 'confirm →'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20 },
  categoryRow: {
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12,
    marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between',
  },
  categoryLabel: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  categoryRequired: { color: '#f97316', fontSize: 11, marginBottom: 8, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  discard: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10,
    padding: 16, alignItems: 'center',
  },
  discardText: { color: '#666', fontSize: 14 },
  confirm: { flex: 2, backgroundColor: '#fff', borderRadius: 10, padding: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: '#000', fontSize: 14, fontWeight: '700' },
});
