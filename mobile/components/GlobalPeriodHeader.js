import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function GlobalPeriodHeader({ periodText, householdName, onPress, style }) {
  const content = (
    <View style={[styles.header, style]}>
      <Text style={styles.periodText}>{periodText}</Text>
      {householdName ? (
        <Text style={styles.householdText} numberOfLines={1}>{householdName}</Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  periodText: {
    fontSize: 14,
    color: '#9a9a9a',
    letterSpacing: 0.3,
    fontWeight: '600',
  },
  householdText: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    color: '#777',
    letterSpacing: 0.2,
    fontWeight: '600',
  },
});
