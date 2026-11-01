import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';
const { normalizeDisplayText } = require('../services/text');

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0.00';
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function sourceLabel(expense = {}) {
  if (expense.source === 'email' || expense.review_source === 'gmail') return 'Gmail import';
  if (expense.source === 'camera') return 'Receipt photo';
  if (expense.source === 'share') return 'Shared receipt';
  if (expense.source === 'refund') return 'Refund';
  return 'Manual entry';
}

function paymentLabel(expense = {}) {
  const method = `${expense.payment_method || ''}`.trim();
  const label = normalizeDisplayText(expense.card_label || '');
  const last4 = `${expense.card_last4 || ''}`.trim();
  if ((!method || method === 'unknown') && !label && !last4) return null;
  const methodLabel = method && method !== 'unknown'
    ? method.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
  return [label || methodLabel, last4 ? `ending ${last4}` : null].filter(Boolean).join(' · ');
}

function locationLabel(expense = {}) {
  const place = normalizeDisplayText(expense.place_name || '');
  const address = normalizeDisplayText(expense.address || '');
  return [place, address && address !== place ? address : null].filter(Boolean).join('\n');
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

export function TransactionPreviewPane({ expense, onOpen }) {
  if (!expense) {
    return (
      <View style={[styles.pane, styles.emptyPane]}>
        <Ionicons name="receipt-outline" size={28} color={colors.textDisabled} />
        <Text style={styles.emptyTitle}>Choose a transaction</Text>
        <Text style={styles.emptyBody}>Its details and supporting context will stay here while you browse.</Text>
      </View>
    );
  }

  const merchant = normalizeDisplayText(expense.merchant || expense.description || 'Expense');
  const description = normalizeDisplayText(expense.description || '');
  const category = normalizeDisplayText(expense.category_parent_name || expense.category_name || 'Uncategorized');
  const payment = paymentLabel(expense);
  const location = locationLabel(expense);
  const items = Array.isArray(expense.items)
    ? expense.items.filter((item) => item?.description).slice(0, 6)
    : [];
  const itemCount = Math.max(items.length, Number(expense.item_count || 0));

  return (
    <View style={styles.pane}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{sourceLabel(expense)}</Text>
            <Text style={styles.merchant}>{merchant}</Text>
          </View>
          <Text style={[styles.amount, Number(expense.amount) < 0 && styles.refundAmount]}>
            {formatAmount(expense.amount)}
          </Text>
        </View>

        {description && description.toLowerCase() !== merchant.toLowerCase() ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}

        <View style={styles.facts}>
          <FactRow label="Date" value={formatDate(expense.date)} />
          <FactRow label="Category" value={category} />
          <FactRow label="Payment" value={payment} />
          <FactRow label="Location" value={location} />
          {expense.exclude_from_budget ? <FactRow label="Budget" value="Tracked separately" /> : null}
          {expense.is_private ? <FactRow label="Visibility" value="Private" /> : null}
        </View>

        {itemCount > 0 ? (
          <View style={styles.itemsBlock}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Purchase items</Text>
              <Text style={styles.sectionMeta}>{itemCount}</Text>
            </View>
            {items.length > 0 ? items.map((item, index) => (
              <View key={item.id || `${item.description}-${index}`} style={styles.itemRow}>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemName} numberOfLines={1}>{normalizeDisplayText(item.description)}</Text>
                  {item.quantity && Number(item.quantity) !== 1 ? (
                    <Text style={styles.itemMeta}>Qty {item.quantity}</Text>
                  ) : null}
                </View>
                <Text style={styles.itemAmount}>
                  {item.amount != null ? formatAmount(item.amount) : ''}
                </Text>
              </View>
            )) : (
              <Text style={styles.itemsUnavailable}>Open the transaction to review its extracted items.</Text>
            )}
            {itemCount > items.length && items.length > 0 ? (
              <Text style={styles.itemsUnavailable}>+{itemCount - items.length} more</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => onOpen(expense)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${merchant} transaction details`}
        >
          <Text style={styles.primaryButtonText}>Open details</Text>
          <Ionicons name="arrow-forward" size={17} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    width: 390,
    minWidth: 0,
    alignSelf: 'stretch',
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  emptyPane: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: spacing.sm },
  emptyBody: { color: colors.textSubtle, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  eyebrow: { color: colors.info, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  merchant: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  amount: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  refundAmount: { color: colors.success },
  description: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  facts: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  factRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, paddingVertical: spacing.sm },
  factLabel: { color: colors.textSubtle, fontSize: 12 },
  factValue: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'right' },
  itemsBlock: { gap: spacing.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionMeta: { color: colors.textSubtle, fontSize: 12, fontWeight: '700' },
  itemRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { color: colors.textMuted, fontSize: 13 },
  itemMeta: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },
  itemAmount: { color: colors.text, fontSize: 13, fontWeight: '600' },
  itemsUnavailable: { color: colors.textSubtle, fontSize: 12, lineHeight: 18 },
  actions: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceRaised },
  primaryButton: { minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
});
