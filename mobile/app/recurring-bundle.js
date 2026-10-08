import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { colors } from '../theme/tokens';

function formatCurrency(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : '—';
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? `${value}`.slice(0, 10)
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RecurringBundleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupKeys = Array.isArray(params.group_keys) ? params.group_keys[0] : params.group_keys;
  const scope = `${Array.isArray(params.scope) ? params.scope[0] : params.scope}` === 'personal' ? 'personal' : 'household';
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!groupKeys) {
        setError('Missing basket items');
        setLoading(false);
        return;
      }
      try {
        const result = await api.get(`/recurring/bundle-history?group_keys=${encodeURIComponent(groupKeys)}&scope=${encodeURIComponent(scope)}`);
        if (!cancelled) setBundle(result);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this usual basket');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [groupKeys, scope]);

  async function addAllToNextShop() {
    if (saving || !bundle?.items?.length) return;
    try {
      setSaving(true);
      await Promise.all(bundle.items.map((item) => api.put('/recurring/item-preferences', {
        group_key: item.group_key,
        state: 'needed',
        remind_on: null,
        target_price: null,
        notes: null,
      })));
      setSaved(true);
    } catch (err) {
      Alert.alert('Could not add the basket', err?.message || 'Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }

  function openItem(item) {
    router.push({
      pathname: '/recurring-item',
      params: { group_key: item.group_key, scope, title: item.item_name || 'Item history' },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: params.title || 'Usual basket', headerBackTitle: 'Insights' }} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.text} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textSubtle} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>SHARED PURCHASE PATTERN</Text>
            <Text style={styles.title}>{bundle.item_count} items tend to come together</Text>
            <Text style={styles.summary}>
              Usually {formatCurrency(bundle.typical_combined_cost)}
              {bundle.usual_merchants?.[0] ? ` at ${bundle.usual_merchants[0]}` : ''}. Review the evidence before treating it as a shopping plan.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryAction, saved && styles.primaryActionSaved]}
            disabled={saving || saved}
            onPress={addAllToNextShop}
            accessibilityRole="button"
            accessibilityLabel="Add all basket items to next shop"
          >
            {saving
              ? <ActivityIndicator color={colors.textInverse} />
              : <Ionicons name={saved ? 'checkmark-circle' : 'cart-outline'} size={20} color={colors.textInverse} />}
            <Text style={styles.primaryActionText}>{saved ? 'Added to next shop' : 'Add all to next shop'}</Text>
          </TouchableOpacity>

          <View style={styles.evidenceBand}>
            <Ionicons name="layers-outline" size={18} color={colors.textSubtle} />
            <Text style={styles.evidenceCopy}>Each item keeps its own timing and price history. The group only appears when their purchase dates repeatedly overlap.</Text>
          </View>

          <View style={styles.list}>
            {bundle.items.map((item) => (
              <TouchableOpacity
                key={item.group_key}
                style={styles.itemRow}
                onPress={() => openItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open history for ${item.item_name || 'item'}`}
              >
                <View style={styles.itemMain}>
                  <Text style={styles.itemName}>{item.item_name || 'Untitled item'}</Text>
                  <Text style={styles.itemMeta}>
                    Every {item.average_gap_days || '—'} days · last {formatShortDate(item.last_purchased_at)}
                  </Text>
                  <Text style={styles.itemMeta}>{item.merchants?.[0] || 'Merchant varies'}</Text>
                </View>
                <View style={styles.itemValue}>
                  <Text style={styles.amount}>{formatCurrency(item.median_amount)}</Text>
                  <Ionicons name="chevron-forward" size={17} color={colors.textDisabled} />
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.listLink} onPress={() => router.push('/shopping-list')} accessibilityRole="button">
            <Text style={styles.listLinkText}>View next shop</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.text} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  error: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  header: { gap: 7 },
  eyebrow: { color: colors.textSubtle, fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '600', letterSpacing: 0 },
  summary: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  primaryAction: {
    minHeight: 50,
    borderRadius: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryActionSaved: { backgroundColor: colors.success },
  primaryActionText: { color: colors.textInverse, fontSize: 15, fontWeight: '600' },
  evidenceBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  evidenceCopy: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  list: { borderTopWidth: 1, borderTopColor: colors.borderStrong },
  itemRow: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  itemMain: { flex: 1, minWidth: 0, gap: 4 },
  itemName: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  itemMeta: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  itemValue: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amount: { color: colors.text, fontSize: 15, fontWeight: '600' },
  listLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listLinkText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
