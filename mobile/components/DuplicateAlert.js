import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const CONFIDENCE_LABEL = {
  exact: 'Exact',
  fuzzy: 'Fuzzy',
  uncertain: 'Uncertain',
};

export function DuplicateAlert({ flags, onDismiss }) {
  if (!flags || flags.length === 0) return null;

  const topFlag = flags[0];
  const confidence = topFlag?.confidence || 'uncertain';
  const label = CONFIDENCE_LABEL[confidence] || confidence;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.message}>Possible duplicate</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
        <Text style={styles.dismissText}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#7c5c00',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    marginTop: -4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  message: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  dismissButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dismissText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
});
