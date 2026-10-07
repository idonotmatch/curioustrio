import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme/tokens';
import { confidencePresentation, fieldProvenance, sourcePresentation } from '../services/provenancePresentation';

export function ProvenanceSummary({ expense = {}, compact = false, style }) {
  const source = sourcePresentation(expense);
  const confidence = confidencePresentation(expense);
  const fields = fieldProvenance(expense, expense?.gmail_review_hint || {});

  return (
    <View style={[styles.container, compact && styles.compact, style]}>
      <View style={[styles.icon, confidence.tone === 'warning' && styles.iconWarning]}>
        <Ionicons name={confidence.icon} size={17} color={confidence.tone === 'warning' ? colors.warning : colors.info} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.source}>{source.label}</Text>
          <Text style={styles.divider}>/</Text>
          <Text style={[styles.status, confidence.tone === 'warning' && styles.statusWarning]}>{confidence.label}</Text>
        </View>
        <Text style={styles.detail}>{confidence.detail}</Text>
        {fields.length > 0 ? (
          <Text style={styles.fields}>
            {fields.map((field) => `${field.label}: ${field.value}`).join('  /  ')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  compact: { paddingVertical: 10 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  iconWarning: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 },
  source: { color: colors.text, fontSize: 13, fontWeight: '700' },
  divider: { color: colors.textDisabled, fontSize: 12 },
  status: { color: colors.info, fontSize: 12, fontWeight: '700' },
  statusWarning: { color: colors.warning },
  detail: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  fields: { color: colors.textSubtle, fontSize: 11, lineHeight: 16, marginTop: 2 },
});
