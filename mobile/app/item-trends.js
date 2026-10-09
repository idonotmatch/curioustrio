import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { useHousehold } from '../hooks/useHousehold';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { EmptyState, InlineError, SkeletonRow } from '../components/ui/States';
import {
  filterItemTrendRows,
  formatItemTrendPrice,
  getItemTrendChange,
} from '../services/itemTrendPresentation';
import { colors, spacing, typography } from '../theme/tokens';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'changed', label: 'Changed' },
  { value: 'stores', label: 'Stores' },
];

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return `${value}`.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ItemTrendRow({ item, onPress }) {
  const change = getItemTrendChange(item);
  const changeColor = change.direction === 'up'
    ? colors.warning
    : change.direction === 'down'
      ? colors.success
      : colors.textSubtle;
  const meta = [
    item.latest_merchant,
    formatShortDate(item.last_purchased_at),
    `${item.occurrence_count} matches`,
  ].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={onPress}
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={`Open price history for ${item.item_name || 'matched item'}`}
    >
      <View style={styles.itemCopy}>
        <Text style={styles.itemName} numberOfLines={1}>{item.item_name || 'Matched item'}</Text>
        {item.brand ? <Text style={styles.itemBrand} numberOfLines={1}>{item.brand}</Text> : null}
        <Text style={styles.itemMeta} numberOfLines={1}>{meta}</Text>
      </View>
      <View style={styles.priceColumn}>
        <Text style={styles.itemPrice} numberOfLines={1}>{formatItemTrendPrice(item)}</Text>
        <Text style={[styles.itemChange, { color: changeColor }]} numberOfLines={1}>{change.label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textDisabled} />
    </TouchableOpacity>
  );
}

export default function ItemTrendsScreen() {
  const router = useRouter();
  const { memberCount } = useHousehold();
  const isMultiMember = memberCount > 1;
  const [scope, setScope] = useState('personal');
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async ({ forceRefresh = false } = {}) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      await loadWithCache(
        `cache:item-trends:v1:${scope}`,
        () => api.get(`/recurring/item-histories?scope=${encodeURIComponent(scope)}&limit=100`),
        (data) => {
          setRows(Array.isArray(data) ? data : []);
          setLoading(false);
        },
        (err) => {
          setError(err?.message || 'Could not load matched item history');
          setLoading(false);
        },
        { maxAgeMs: 5 * 60 * 1000, forceRefresh }
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const filteredRows = useMemo(
    () => filterItemTrendRows(rows, { query, filter }),
    [filter, query, rows]
  );

  function openItem(item) {
    router.push({
      pathname: '/recurring-item',
      params: {
        group_key: item.group_key,
        scope,
        title: item.item_name || 'Item history',
        origin: 'item-trends',
      },
    });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Item price trends', headerBackTitle: 'Activity' }} />
      <FlatList
        data={filteredRows}
        keyExtractor={(item) => item.group_key}
        renderItem={({ item }) => <ItemTrendRow item={item} onPress={() => openItem(item)} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ forceRefresh: true })}
            tintColor={colors.text}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={(
          <View style={styles.header}>
            <Text style={styles.intro}>
              Browse repeat items from receipts and imports. Open one to compare prices, stores, and source purchases.
            </Text>
            {isMultiMember ? (
              <SegmentedControl
                options={[
                  { value: 'personal', label: 'Mine' },
                  { value: 'household', label: 'Household' },
                ]}
                value={scope}
                onChange={setScope}
              />
            ) : null}
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={colors.textSubtle} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search item, brand, or store"
                placeholderTextColor={colors.textDisabled}
                style={styles.searchInput}
                returnKeyType="search"
                autoCorrect
                clearButtonMode="while-editing"
                accessibilityLabel="Search matched items"
              />
            </View>
            <SegmentedControl
              options={FILTER_OPTIONS}
              value={filter}
              onChange={setFilter}
              style={styles.filters}
            />
            {error && rows.length > 0 ? (
              <InlineError
                title="Showing saved item trends"
                body="The latest matches could not be refreshed."
                onAction={() => load({ forceRefresh: true })}
              />
            ) : null}
          </View>
        )}
        ListEmptyComponent={loading ? (
          <View style={styles.loadingRows}>
            <SkeletonRow lines={3} />
            <SkeletonRow lines={3} />
            <SkeletonRow lines={3} />
          </View>
        ) : error ? (
          <InlineError
            title="Could not load item trends"
            body={error}
            onAction={() => load({ forceRefresh: true })}
          />
        ) : rows.length > 0 ? (
          <EmptyState
            icon="search-outline"
            title="No matching items"
            body="Try a different search or filter."
            compact
          />
        ) : (
          <EmptyState
            icon="trending-up-outline"
            title="No repeat items yet"
            body="Price histories appear after the same item is matched across at least two purchases."
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 48 },
  header: { gap: spacing.md, paddingBottom: spacing.lg },
  intro: { color: colors.textMuted, ...typography.body },
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 15 },
  filters: { alignSelf: 'stretch' },
  itemRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  itemBrand: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  itemMeta: { color: colors.textSubtle, fontSize: 12, lineHeight: 16 },
  priceColumn: { maxWidth: 118, alignItems: 'flex-end', gap: 3 },
  itemPrice: { color: colors.text, fontSize: 14, fontWeight: '700' },
  itemChange: { fontSize: 12, fontWeight: '650' },
  loadingRows: { gap: spacing.sm },
});
