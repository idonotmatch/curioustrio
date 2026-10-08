import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../services/api';
import { colors } from '../theme/tokens';

function formatCurrency(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : null;
}

function formatPriceBasis(unit) {
  if (unit === 'fl_oz') return 'fl oz';
  if (unit === 'ea' || unit === 'ct') return 'item';
  return unit || 'item';
}

export default function ShoppingListScreen() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const loadItems = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      const result = await api.get('/recurring/planning-items');
      setItems(Array.isArray(result) ? result : []);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load your next shop');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadItems();
  }, [loadItems]));

  async function removeItem(item) {
    if (!item?.group_key || busyKey) return;
    try {
      setBusyKey(item.group_key);
      await api.put('/recurring/item-preferences', {
        group_key: item.group_key,
        state: 'watching',
        remind_on: item.remind_on || null,
        target_price: item.target_price ?? null,
        notes: item.notes || null,
      });
      setItems((current) => current.filter((entry) => entry.group_key !== item.group_key));
    } catch (err) {
      setError(err?.message || 'Could not update this item');
    } finally {
      setBusyKey('');
    }
  }

  function openItem(item) {
    router.push({
      pathname: '/recurring-item',
      params: {
        group_key: item.group_key,
        scope: item.scope || 'household',
        title: item.item_name || 'Item history',
      },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Next shop', headerBackTitle: 'Back' }} />
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadItems({ refresh: true })} tintColor={colors.text} />}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>PLANNED ITEMS</Text>
            <Text style={styles.title}>Your next shop</Text>
            <Text style={styles.subtitle}>Items you saved from purchase patterns and price insights.</Text>
          </View>

          {error ? (
            <TouchableOpacity style={styles.errorBand} onPress={() => loadItems()} accessibilityRole="button">
              <Ionicons name="refresh" size={17} color={colors.danger} />
              <Text style={styles.errorText}>{error}. Tap to retry.</Text>
            </TouchableOpacity>
          ) : null}

          {!items.length ? (
            <View style={styles.emptyState}>
              <Ionicons name="basket-outline" size={30} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>Nothing queued</Text>
              <Text style={styles.emptyCopy}>Add an item from its insight or purchase-history screen when it belongs on your next shop.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {items.map((item) => {
                const price = item.median_unit_price != null
                  ? `${formatCurrency(item.median_unit_price)} / ${formatPriceBasis(item.price_basis_unit)}`
                  : formatCurrency(item.median_amount);
                return (
                  <View key={item.group_key} style={styles.itemRow}>
                    <TouchableOpacity style={styles.itemMain} onPress={() => openItem(item)} accessibilityRole="button">
                      <Text style={styles.itemName}>{item.item_name || 'Untitled item'}</Text>
                      <Text style={styles.itemMeta}>
                        {[item.usual_merchant, price].filter(Boolean).join('  •  ') || 'Purchase history available'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => removeItem(item)}
                      disabled={busyKey === item.group_key}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.item_name || 'item'} from next shop`}
                    >
                      {busyKey === item.group_key
                        ? <ActivityIndicator size="small" color={colors.textMuted} />
                        : <Ionicons name="checkmark" size={20} color={colors.success} />}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: 5 },
  eyebrow: { color: colors.textSubtle, fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 28, fontWeight: '600', letterSpacing: 0 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, maxWidth: 430 },
  errorBand: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.danger,
    paddingVertical: 10,
  },
  errorText: { color: colors.danger, flex: 1, fontSize: 13 },
  emptyState: {
    minHeight: 220,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 8,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyCopy: { color: colors.textMuted, fontSize: 14, lineHeight: 20, maxWidth: 390 },
  list: { borderTopWidth: 1, borderTopColor: colors.borderStrong },
  itemRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingVertical: 12,
  },
  itemMain: { flex: 1, minWidth: 0, gap: 4 },
  itemName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  itemMeta: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  removeButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
