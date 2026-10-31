import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';
import { reviewQueueGuidance, reviewQueueLabel } from './ReviewQueueItem';
const { normalizeDisplayText } = require('../services/text');

function formatAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '$0.00';
}

export function ReviewQueuePreviewPane({ expense, disabled, onApprove, onDismiss, onOpen }) {
  if (!expense) {
    return (
      <View style={[styles.pane, styles.emptyPane]}>
        <Ionicons name="mail-open-outline" size={28} color={colors.textDisabled} />
        <Text style={styles.emptyTitle}>Choose an import</Text>
        <Text style={styles.emptyBody}>Its decision context will stay here while you work through the queue.</Text>
      </View>
    );
  }

  const duplicate = Array.isArray(expense.duplicate_flags) && expense.duplicate_flags.length > 0;
  const itemsFirst = expense?.gmail_review_hint?.review_mode === 'items_first';
  const items = Array.isArray(expense.items) ? expense.items.filter((item) => item?.description).slice(0, 5) : [];
  const subject = normalizeDisplayText(expense?.gmail_review_hint?.message_subject || expense?.email_subject || '');
  const merchant = normalizeDisplayText(expense.merchant || expense.description || 'Unknown merchant');
  const guidance = normalizeDisplayText(reviewQueueGuidance(expense));
  const category = normalizeDisplayText(expense.category_name || expense.category_parent_name || 'Uncategorized');

  return (
    <View style={styles.pane}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{reviewQueueLabel(expense)}</Text>
            <Text style={styles.merchant}>{merchant}</Text>
          </View>
          <Text style={styles.amount}>{formatAmount(expense.amount)}</Text>
        </View>

        {subject && subject !== merchant ? <Text style={styles.subject}>{subject}</Text> : null}

        <View style={styles.guidanceCard}>
          <Ionicons name={duplicate ? 'git-compare-outline' : itemsFirst ? 'list-outline' : 'sparkles-outline'} size={18} color={duplicate || itemsFirst ? colors.warning : colors.info} />
          <Text style={styles.guidance}>{guidance}</Text>
        </View>

        <View style={styles.facts}>
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Date</Text>
            <Text style={styles.factValue}>{expense.date || 'Not found'}</Text>
          </View>
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Category</Text>
            <Text style={styles.factValue}>{category}</Text>
          </View>
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Source</Text>
            <Text style={styles.factValue}>{expense.source === 'email' || expense.review_source === 'gmail' ? 'Gmail' : 'Import'}</Text>
          </View>
        </View>

        {items.length > 0 ? (
          <View style={styles.itemsBlock}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Extracted items</Text>
              <Text style={styles.sectionMeta}>{items.length}{Number(expense.item_count || 0) > items.length ? '+' : ''}</Text>
            </View>
            {items.map((item, index) => (
              <View key={item.id || `${item.description}-${index}`} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{normalizeDisplayText(item.description)}</Text>
                <Text style={styles.itemAmount}>{formatAmount(item.amount ?? item.total_price ?? item.unit_price)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => onDismiss(expense.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${merchant}`}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
        {!duplicate && !itemsFirst ? (
          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() => onApprove(expense.id)}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryActionText}>Approve</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => onOpen(expense)}
          disabled={disabled}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{duplicate ? 'Compare' : itemsFirst ? 'Review items' : 'Edit details'}</Text>
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
  subject: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  guidanceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  guidance: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  facts: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  factRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  factLabel: { color: colors.textSubtle, fontSize: 12 },
  factValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  itemsBlock: { gap: spacing.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionMeta: { color: colors.textSubtle, fontSize: 12, fontWeight: '700' },
  itemRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  itemName: { flex: 1, color: colors.textMuted, fontSize: 13 },
  itemAmount: { color: colors.text, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceRaised },
  secondaryButton: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.dangerBorder, alignItems: 'center', justifyContent: 'center' },
  secondaryAction: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  primaryButton: { flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  primaryButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
});
