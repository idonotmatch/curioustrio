import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
    backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8,
  },
  label: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  value: { fontSize: 14, color: '#fff' },
});
