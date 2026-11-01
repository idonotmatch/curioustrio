import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { loadWithCache } from '../services/cache';
import { getItemPriceTrendVisual, getItemTrendChange } from '../services/itemTrendPresentation';
import { InsightTrendVisual } from './InsightTrendVisual';
import { colors, radius, spacing } from '../theme/tokens';

function formatCurrency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : null;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function FactRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export function ItemTrendPreviewPane({ item, scope, onOpen }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!item?.group_key) {
      setHistory(null);
      setError('');
      setLoading(false);
      return () => { cancelled = true; };
    }
    setHistory(null);
    setError('');
    setLoading(true);
    loadWithCache(
      `cache:recurring-item:${scope}:${item.group_key}`,
      () => api.get(`/recurring/item-history?group_key=${encodeURIComponent(item.group_key)}&scope=${encodeURIComponent(scope)}`),
      (data) => {
        if (cancelled) return;
        setHistory(data);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err?.message || 'Could not load this price history');
        setLoading(false);
      },
      { maxAgeMs: 5 * 60 * 1000 }
    ).catch((err) => {
      if (cancelled) return;
      setError(err?.message || 'Could not load this price history');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [item?.group_key, scope]);

  const visual = useMemo(() => getItemPriceTrendVisual(history || {}), [history]);

  if (!item) {
    return (
      <View style={[styles.pane, styles.emptyPane]}>
        <Ionicons name="trending-up-outline" size={28} color={colors.textDisabled} />
        <Text style={styles.emptyTitle}>Choose an item</Text>
        <Text style={styles.emptyBody}>Its matched prices, stores, and source purchases will stay here while you browse.</Text>
      </View>
    );
  }

  const change = getItemTrendChange(item);
  const purchases = Array.isArray(history?.purchases) ? history.purchases.slice(-4).reverse() : [];
  const merchants = Array.isArray(history?.merchant_price_history) ? history.merchant_price_history.slice(0, 4) : [];
  const median = history?.median_unit_price ?? history?.median_amount;
  const latest = item.latest_price;

  return (
    <View style={styles.pane}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Matched price history</Text>
            <Text style={styles.title}>{item.item_name || 'Matched item'}</Text>
            {item.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}
          </View>
          <View style={styles.priceCopy}>
            <Text style={styles.latestPrice}>{formatCurrency(latest) || '-'}</Text>
            <Text style={[
              styles.change,
              change.direction === 'up' && styles.changeWarning,
              change.direction === 'down' && styles.changePositive,
            ]}>{change.label}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={styles.loadingText}>Loading comparable purchases...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBlock}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            {visual ? <InsightTrendVisual visual={visual} /> : null}

            <View style={styles.facts}>
              <FactRow label="Typical price" value={formatCurrency(median)} />
              <FactRow label="Purchases matched" value={history?.occurrence_count ? `${history.occurrence_count}` : `${item.occurrence_count || 0}`} />
              <FactRow label="Stores compared" value={`${history?.merchants?.length || item.merchant_count || merchants.length || 1}`} />
              <FactRow label="Last purchased" value={formatDate(history?.last_purchased_at || item.last_purchased_at)} />
            </View>

            {merchants.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Store comparison</Text>
                {merchants.map((merchant, index) => (
                  <View key={`${merchant.merchant || 'store'}-${index}`} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{merchant.merchant || 'Unknown store'}</Text>
                      <Text style={styles.rowMeta}>{merchant.occurrence_count || 0} purchase{Number(merchant.occurrence_count || 0) === 1 ? '' : 's'}</Text>
                    </View>
                    <Text style={styles.rowValue}>{formatCurrency(merchant.median_unit_price ?? merchant.median_amount) || '-'}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {purchases.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent source purchases</Text>
                {purchases.map((purchase, index) => (
                  <View key={purchase.id || purchase.expense_item_id || `${purchase.date}-${index}`} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{purchase.merchant || 'Purchase'}</Text>
                      <Text style={styles.rowMeta}>{formatDate(purchase.date)}</Text>
                    </View>
                    <Text style={styles.rowValue}>{formatCurrency(purchase.estimated_unit_price ?? purchase.item_amount ?? purchase.amount) || '-'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => onOpen(item)}
          accessibilityRole="button"
          accessibilityLabel={`Open full price history for ${item.item_name || 'matched item'}`}
        >
          <Text style={styles.primaryButtonText}>Open full history</Text>
          <Ionicons name="arrow-forward" size={17} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { width: 390, minWidth: 0, alignSelf: 'stretch', borderLeftWidth: 1, borderLeftColor: colors.borderSubtle, backgroundColor: colors.surface },
  emptyPane: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: spacing.sm },
  emptyBody: { color: colors.textSubtle, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  eyebrow: { color: colors.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  brand: { color: colors.textMuted, fontSize: 13 },
  priceCopy: { alignItems: 'flex-end', gap: spacing.xs, maxWidth: 118 },
  latestPrice: { color: colors.text, fontSize: 19, lineHeight: 25, fontWeight: '700' },
  change: { color: colors.textSubtle, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  changeWarning: { color: colors.warning },
  changePositive: { color: colors.success },
  loadingBlock: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { color: colors.textSubtle, fontSize: 12 },
  errorBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.warningMuted, borderWidth: 1, borderColor: colors.warningBorder },
  errorText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  facts: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  factRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  factLabel: { color: colors.textSubtle, fontSize: 12 },
  factValue: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  section: { gap: spacing.xs },
  sectionTitle: { color: colors.textSubtle, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.xs },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '700' },
  actions: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceRaised },
  primaryButton: { minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
});
