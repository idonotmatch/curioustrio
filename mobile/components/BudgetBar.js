import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

export function BudgetBar({ spent, limit, label }) {
  if (!limit) return null;
  const pct = Math.min(spent / limit, 1);
  const over = spent > limit;
  const remaining = limit - spent;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label || 'Budget'}</Text>
        <Text style={[styles.remaining, over && styles.over]}>
          {over ? `$${(spent - limit).toFixed(2)} over` : `$${remaining.toFixed(2)} left`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }, over && styles.fillOver]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 11, color: colors.textDisabled },
  remaining: { fontSize: 11, color: colors.textSubtle },
  over: { color: colors.warning },
  track: { height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.text, borderRadius: 2 },
  fillOver: { backgroundColor: colors.warning },
});
