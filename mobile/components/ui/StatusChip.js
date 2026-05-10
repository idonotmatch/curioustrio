import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';

const TONES = {
  success: { bg: colors.successMuted, border: colors.successBorder, text: colors.success },
  warning: { bg: colors.warningMuted, border: colors.warningBorder, text: colors.warning },
  danger: { bg: colors.dangerMuted, border: colors.dangerBorder, text: colors.danger },
  info: { bg: colors.infoMuted, border: colors.infoBorder, text: colors.info },
  neutral: { bg: colors.surfaceRaised, border: colors.border, text: colors.textMuted },
};

export function statusToneForState(state = '') {
  const normalized = `${state || ''}`.toLowerCase();
  if (/(confirmed|healthy|success|imported|reviewed|approved|ok)/.test(normalized)) return 'success';
  if (/(uncertain|pending|review|skipped|stale|attention|warning)/.test(normalized)) return 'warning';
  if (/(failed|error|danger|dismissed|disconnected)/.test(normalized)) return 'danger';
  if (/(info|sync|connected|unlogged|checking)/.test(normalized)) return 'info';
  return 'neutral';
}

export function StatusChip({ label, tone, style, textStyle }) {
  const palette = TONES[tone] || TONES.neutral;
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg, borderColor: palette.border }, style]}>
      <Text style={[styles.text, { color: palette.text }, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: 'center',
  },
  text: {
    fontSize: 11,
    fontWeight: '750',
  },
});
