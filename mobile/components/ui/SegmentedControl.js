import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';

export function SegmentedControl({ options, value, onChange, disabled = false, style }) {
  return (
    <View style={[styles.container, disabled && styles.disabled, style]} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, active && styles.optionActive]}
            onPress={() => onChange?.(option.value)}
            disabled={disabled || active}
            activeOpacity={0.84}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel || option.label}
            accessibilityState={{ selected: active, disabled }}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 3,
    gap: spacing.xs,
  },
  option: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 34,
    justifyContent: 'center',
  },
  optionActive: {
    backgroundColor: colors.accent,
  },
  optionText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '700',
  },
  optionTextActive: {
    color: colors.textInverse,
  },
  disabled: {
    opacity: 0.5,
  },
});
