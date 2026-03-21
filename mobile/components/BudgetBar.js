import { View, Text, StyleSheet } from 'react-native';

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
  label: { fontSize: 11, color: '#666' },
  remaining: { fontSize: 11, color: '#888' },
  over: { color: '#f97316' },
  track: { height: 4, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#fff', borderRadius: 2 },
  fillOver: { backgroundColor: '#f97316' },
});
