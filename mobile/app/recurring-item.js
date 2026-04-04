import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../services/api';

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toFixed(2)}`;
}

export default function RecurringItemScreen() {
  const { group_key: groupKey, title } = useLocalSearchParams();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!groupKey) {
        setError('Missing recurring item');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await api.get(`/recurring/item-history?group_key=${encodeURIComponent(groupKey)}`);
        if (!cancelled) {
          setHistory(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load recurring item history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupKey]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen options={{ title: title || 'Recurring item' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#f5f5f5" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : history ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.itemName}>{history.item_name}</Text>
              {history.brand ? <Text style={styles.subtle}>{history.brand}</Text> : null}
              <Text style={styles.heroStat}>
                Every {history.average_gap_days || '—'} days · {history.occurrence_count} purchases
              </Text>
              <Text style={styles.heroStat}>
                Median price {formatCurrency(history.median_amount)}
                {history.median_unit_price != null ? ` · ${formatCurrency(history.median_unit_price)} / unit` : ''}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Timing</Text>
              <Text style={styles.rowText}>Last purchased: {history.last_purchased_at || '—'}</Text>
              <Text style={styles.rowText}>Next expected: {history.next_expected_date || '—'}</Text>
              <Text style={styles.rowText}>Merchants: {(history.merchants || []).join(', ') || '—'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent purchases</Text>
              {(history.purchases || []).map((purchase) => (
                <View key={`${purchase.date}:${purchase.merchant}:${purchase.item_amount}`} style={styles.purchaseRow}>
                  <View>
                    <Text style={styles.purchaseMerchant}>{purchase.merchant || 'Unknown merchant'}</Text>
                    <Text style={styles.purchaseDate}>{purchase.date}</Text>
                  </View>
                  <View style={styles.purchaseRight}>
                    <Text style={styles.purchaseAmount}>{formatCurrency(purchase.item_amount)}</Text>
                    {purchase.estimated_unit_price != null ? (
                      <Text style={styles.purchaseUnit}>{formatCurrency(purchase.estimated_unit_price)} / unit</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#999', fontSize: 15 },
  hero: { gap: 6, marginBottom: 8 },
  itemName: { fontSize: 30, color: '#f5f5f5', fontWeight: '600', letterSpacing: -0.8 },
  subtle: { fontSize: 14, color: '#888' },
  heroStat: { fontSize: 14, color: '#b5b5b5' },
  card: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  rowText: { fontSize: 14, color: '#e5e5e5' },
  purchaseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  purchaseMerchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  purchaseDate: { fontSize: 13, color: '#888', marginTop: 2 },
  purchaseRight: { alignItems: 'flex-end' },
  purchaseAmount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },
  purchaseUnit: { fontSize: 12, color: '#888', marginTop: 2 },
});
