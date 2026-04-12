import { View, Text, StyleSheet } from 'react-native';

export function ActionNotice({ message }) {
  if (!message) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.notice}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    alignItems: 'center',
    zIndex: 10,
  },
  notice: {
    maxWidth: 320,
    backgroundColor: '#141920',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2b3442',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: {
    color: '#dbe7f7',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
