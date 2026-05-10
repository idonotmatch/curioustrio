import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hitSlop, radius, spacing, typography } from '../../theme/tokens';

export function PrimaryButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  accessibilityLabel,
}) {
  return (
    <TouchableOpacity
      style={[styles.primary, (disabled || loading) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.86}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.textInverse} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={colors.textInverse} /> : null}
          <Text style={[styles.primaryText, textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  accessibilityLabel,
}) {
  return (
    <TouchableOpacity
      style={[styles.secondary, (disabled || loading) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={colors.text} /> : null}
          <Text style={[styles.secondaryText, textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function IconButton({ icon, onPress, label, disabled = false, size = 34, color = colors.text, style }) {
  return (
    <TouchableOpacity
      style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2 }, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.78}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={Math.round(size * 0.52)} color={color} />
    </TouchableOpacity>
  );
}

export function ActionRow({ title, body, icon, onPress, disabled = false, trailingIcon = 'chevron-forward', style }) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
    >
      {icon ? (
        <View style={styles.actionIcon}>
          <Ionicons name={icon} size={18} color={colors.text} />
        </View>
      ) : null}
      <View style={styles.actionCopy}>
        <Text style={styles.actionTitle}>{title}</Text>
        {body ? <Text style={styles.actionBody}>{body}</Text> : null}
      </View>
      {trailingIcon ? <Ionicons name={trailingIcon} size={16} color={colors.textSubtle} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '750',
  },
  secondary: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  secondaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  iconButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.surfacePressed,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  actionCopy: {
    flex: 1,
    gap: 3,
  },
  actionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  actionBody: {
    color: colors.textMuted,
    ...typography.bodySmall,
  },
  disabled: {
    opacity: 0.45,
  },
});
