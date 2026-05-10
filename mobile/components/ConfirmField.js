import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

export function ConfirmField({ label, value, onPress }) {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? '—'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8,
  },
  label: { fontSize: 10, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },
  value: { fontSize: 14, color: colors.text },
});
