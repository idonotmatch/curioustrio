import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/tokens';

function toneStyle(styles, tone) {
  if (tone === 'warning' || tone === 'attention') return styles.movementToneWarning;
  if (tone === 'positive') return styles.movementTonePositive;
  if (tone === 'info') return styles.movementToneInfo;
  return styles.movementToneNeutral;
}

function iconForState(state) {
  if (`${state}`.includes('down') || `${state}`.includes('under')) return 'trending-down';
  if (`${state}`.includes('pending')) return 'alert-circle-outline';
  if (`${state}`.includes('confidence')) return 'pulse-outline';
  if (`${state}`.includes('import')) return 'mail-outline';
  if (`${state}`.includes('first')) return 'sparkles-outline';
  return 'trending-up';
}

export function SummaryForecastMovement({
  styles,
  movement,
  loading = false,
  freshnessLabel = '',
  onPressCTA,
}) {
  if (loading && !movement) {
    return (
      <View style={styles.movementSection}>
        <View style={styles.movementHeader}>
          <Text style={styles.sectionLabelCompact}>What changed</Text>
        </View>
        <View style={styles.movementCard}>
          <View style={styles.movementSkeletonIcon} />
          <View style={styles.movementCopy}>
            <View style={styles.movementSkeletonTitle} />
            <View style={styles.movementSkeletonBody} />
            <View style={styles.movementSkeletonBodyShort} />
          </View>
        </View>
      </View>
    );
  }

  const display = movement || {
    state: 'quiet_stable',
    tone: 'neutral',
    title: 'Month view is steady',
    body: 'No meaningful forecast movement since the last update.',
  };
  const cta = display.cta || null;

  return (
    <View style={styles.movementSection}>
      <View style={styles.movementHeader}>
        <Text style={styles.sectionLabelCompact}>What changed</Text>
        {display.source ? <Text style={styles.movementSource}>{display.source}</Text> : null}
      </View>

      <TouchableOpacity
        activeOpacity={cta ? 0.86 : 1}
        onPress={cta ? () => onPressCTA?.(cta) : undefined}
        style={styles.movementCard}
      >
        <View style={[styles.movementIcon, toneStyle(styles, display.tone)]}>
          <Ionicons name={iconForState(display.state)} size={17} color={colors.text} />
        </View>
        <View style={styles.movementCopy}>
          <Text style={styles.movementTitle}>{display.title}</Text>
          <Text style={styles.movementBody}>{display.body}</Text>
          {display.metric?.display ? (
            <Text style={styles.movementMetric}>{display.metric.display}</Text>
          ) : null}
          {freshnessLabel ? (
            <Text style={styles.movementFreshness}>{freshnessLabel}</Text>
          ) : null}
        </View>
        {cta ? (
          <View style={styles.movementCTA}>
            <Text style={styles.movementCTAText}>{cta.label}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}
