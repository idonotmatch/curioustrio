import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme/tokens';

export function SectionHeader({ eyebrow, title, body, actionLabel, onAction, style }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionHeaderCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
        {body ? <Text style={styles.sectionBody}>{body}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={styles.inlineAction}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body, actionLabel, onAction, icon = 'file-tray-outline', compact = false, style }) {
  return (
    <View style={[compact ? styles.emptyCompact : styles.empty, style]}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
      </View>
      <View style={styles.stateCopy}>
        <Text style={styles.stateTitle}>{title}</Text>
        {body ? <Text style={styles.stateBody}>{body}</Text> : null}
        {actionLabel && onAction ? (
          <TouchableOpacity style={styles.stateAction} onPress={onAction} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={actionLabel}>
            <Text style={styles.stateActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function InlineError({ title = 'Something went wrong', body, actionLabel = 'Try again', onAction, style }) {
  return (
    <View style={[styles.error, style]}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <View style={styles.stateCopy}>
        <Text style={styles.errorTitle}>{title}</Text>
        {body ? <Text style={styles.errorBody}>{body}</Text> : null}
        {onAction ? (
          <TouchableOpacity style={styles.errorAction} onPress={onAction} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={actionLabel}>
            <Text style={styles.errorActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function LoadingState({ label = 'Loading', compact = false, style }) {
  return (
    <View style={[compact ? styles.loadingCompact : styles.loading, style]}>
      <ActivityIndicator color={colors.textMuted} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function SkeletonRow({ lines = 2, style }) {
  return (
    <View style={[styles.skeletonRow, style]}>
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.skeletonLine,
            index === 0 ? styles.skeletonLinePrimary : styles.skeletonLineSecondary,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionHeaderCopy: { flex: 1, gap: 4 },
  eyebrow: { color: colors.textSubtle, ...typography.eyebrow },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '750' },
  sectionBody: { color: colors.textMuted, ...typography.bodySmall },
  inlineAction: { color: colors.info, fontSize: 13, fontWeight: '750' },
  empty: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  emptyCompact: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stateIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateCopy: { flex: 1, gap: 4 },
  stateTitle: { color: colors.text, fontSize: 14, fontWeight: '750', lineHeight: 19 },
  stateBody: { color: colors.textMuted, ...typography.bodySmall },
  stateAction: { alignSelf: 'flex-start', marginTop: spacing.xs },
  stateActionText: { color: colors.info, fontSize: 13, fontWeight: '750' },
  error: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerMuted,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  errorTitle: { color: colors.text, fontSize: 14, fontWeight: '750' },
  errorBody: { color: colors.danger, ...typography.bodySmall },
  errorAction: { alignSelf: 'flex-start', marginTop: spacing.xs },
  errorActionText: { color: colors.danger, fontSize: 13, fontWeight: '750' },
  loading: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingCompact: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: { color: colors.textMuted, ...typography.bodySmall },
  skeletonRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfacePressed,
  },
  skeletonLinePrimary: { width: '68%' },
  skeletonLineSecondary: { width: '42%', opacity: 0.72 },
});
