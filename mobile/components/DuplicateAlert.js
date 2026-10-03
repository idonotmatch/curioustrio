import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

const CONFIDENCE_LABEL = {
  exact: 'Exact',
  fuzzy: 'Fuzzy',
  uncertain: 'Uncertain',
};

export function DuplicateAlert({ flags, onCompare }) {
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
      <TouchableOpacity style={styles.compareButton} onPress={onCompare}>
        <Text style={styles.compareText}>Compare expenses</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.warningMuted,
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
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  badge: {
    backgroundColor: colors.onDarkOverlay,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  compareButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.onDarkOverlayStrong,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  compareText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
});
