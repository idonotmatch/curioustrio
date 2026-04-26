import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function SmartSuggestionCard({
  eyebrow,
  title,
  body,
  dismissLabel = 'Dismiss',
  acceptLabel = 'Use this',
  onDismiss,
  onAccept,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.dismiss} onPress={onDismiss}>
          <Text style={styles.dismissText}>{dismissLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.accept} onPress={onAccept}>
          <Text style={styles.acceptText}>{acceptLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#151515',
    padding: 12,
    gap: 10,
  },
  copy: { gap: 3 },
  eyebrow: { color: '#8a8a8a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.9 },
  title: { color: '#f4f4f4', fontSize: 14, fontWeight: '600' },
  body: { color: '#8f8f8f', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 8 },
  dismiss: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#101010',
  },
  dismissText: { color: '#bebebe', fontSize: 12, fontWeight: '600' },
  accept: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#f5f5f5',
  },
  acceptText: { color: '#000', fontSize: 12, fontWeight: '700' },
});
