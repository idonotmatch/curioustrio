import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';

function formatValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '0';
  return `${value ?? '0'}`;
}

export function MetricStrip({ items = [], compact = false, style }) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return null;
  return (
    <View style={[styles.strip, compact && styles.stripCompact, style]}>
      {visibleItems.map((item, index) => (
        <View
          key={item.key || item.label || index}
          style={[
            styles.item,
            index > 0 && styles.itemDivider,
            compact && styles.itemCompact,
          ]}
        >
          <Text style={styles.value} numberOfLines={1}>{formatValue(item.value)}</Text>
          <Text style={styles.label} numberOfLines={2}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  stripCompact: {
    borderRadius: radius.sm,
  },
  item: {
    flex: 1,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    gap: 5,
  },
  itemCompact: {
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  itemDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
  },
  value: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '750',
  },
  label: {
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '650',
  },
});
