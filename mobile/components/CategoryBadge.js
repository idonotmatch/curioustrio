import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

export function CategoryBadge({ name, confidence, source }) {
  const dots = '●'.repeat(confidence) + '○'.repeat(4 - confidence);
  const label = source === 'memory' ? 'from memory' : 'suggested';

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{name || 'Unclassified'}</Text>
      {confidence > 0 && (
        <Text style={styles.confidence}>{label} {dots}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14, color: colors.text },
  confidence: { fontSize: 10, color: colors.textDisabled },
});
