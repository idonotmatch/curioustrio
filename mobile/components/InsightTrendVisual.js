import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

const SPARK_WIDTH = 112;
const SPARK_HEIGHT = 30;
const DOT_SIZE = 7;

function toneColor(tone) {
  if (tone === 'danger') return colors.danger;
  if (tone === 'warning') return colors.warning;
  if (tone === 'info') return colors.info;
  return colors.accent;
}

function valueChipStyle(tone) {
  if (tone === 'danger') return styles.valueChipDanger;
  if (tone === 'warning') return styles.valueChipWarning;
  if (tone === 'info') return styles.valueChipInfo;
  return styles.valueChipNeutral;
}

function SparkLine({ points = [], tone }) {
  const activeColor = toneColor(tone);
  const xStep = points.length > 1 ? SPARK_WIDTH / (points.length - 1) : SPARK_WIDTH;
  const coords = points.map((point, index) => ({
    x: index * xStep,
    y: SPARK_HEIGHT - (point * SPARK_HEIGHT),
  }));

  return (
    <View style={styles.sparkCanvas}>
      <View style={styles.sparkBaseline} />
      {coords.slice(0, -1).map((point, index) => {
        const next = coords[index + 1];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.sqrt((dx * dx) + (dy * dy));
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={`${point.x}:${point.y}`}
            style={[
              styles.sparkSegment,
              {
                backgroundColor: activeColor,
                left: point.x,
                top: point.y,
                width: length,
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
          />
        );
      })}
      {coords.map((point, index) => (
        <View
          key={`${point.x}:dot`}
          style={[
            styles.sparkDot,
            {
              backgroundColor: index === coords.length - 1 ? activeColor : colors.surfaceRaised,
              borderColor: activeColor,
              left: point.x - 3,
              top: point.y - 3,
            },
          ]}
        />
      ))}
    </View>
  );
}

function PaceRail({ progress = 0, marker = null, projection = null, tone }) {
  const fill = Math.max(0, Math.min(progress, 1));
  const overflow = Math.max(0, Math.min(progress - 1, 0.2));
  const activeColor = toneColor(tone);
  const projectedProgress = projection?.projectedDelta == null
    ? null
    : Math.max(0, Math.min(1.15, 1 + (Number(projection.projectedDelta) / Math.max(Math.abs(Number(projection.projectedDelta)) * 5, 500))));

  return (
    <View style={styles.paceWrap}>
      <View style={styles.paceRail}>
        <View style={[styles.paceFill, { width: `${fill * 100}%`, backgroundColor: activeColor }]} />
        {overflow > 0 ? <View style={[styles.paceOverflow, { width: `${overflow * 100}%` }]} /> : null}
        {marker != null ? <View style={[styles.paceMarker, { left: `${Math.min(marker, 1) * 100}%` }]} /> : null}
        {projectedProgress != null ? <View style={[styles.projectionMarker, { left: `${Math.min(projectedProgress, 1) * 100}%` }]} /> : null}
      </View>
    </View>
  );
}

function RhythmDots({ count = 3, activeIndex = null, tone }) {
  const activeColor = toneColor(tone);
  const dots = Array.from({ length: 6 }, (_, index) => index);
  const visibleCount = Math.max(2, Math.min(count, 6));

  return (
    <View style={styles.rhythmRow}>
      {dots.map((index) => {
        const isVisible = index < visibleCount;
        const isActive = activeIndex != null ? index === activeIndex : index === visibleCount - 1;
        return (
          <View
            key={index}
            style={[
              styles.rhythmDot,
              {
                opacity: isVisible ? 1 : 0.28,
                backgroundColor: isVisible && isActive ? activeColor : colors.surfacePressed,
                borderColor: isVisible ? activeColor : colors.borderStrong,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export function InsightTrendVisual({ visual, compact = false, showProjection = true, showValue = true }) {
  if (!visual) return null;
  const tone = visual.tone || 'neutral';
  const showValueChip = Boolean(showValue && visual.value && visual.value !== visual.projection?.value);

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.copyBlock}>
        <Text style={styles.label} numberOfLines={1}>{visual.label}</Text>
        {showValueChip ? (
          <View style={[styles.valueChip, valueChipStyle(tone)]}>
            <Text style={styles.valueText} numberOfLines={1}>{visual.value}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.visualBlock}>
        {visual.variant === 'pace' ? <PaceRail progress={visual.progress} marker={visual.marker} projection={visual.projection} tone={tone} /> : null}
        {visual.variant === 'spark' ? <SparkLine points={visual.points} tone={tone} /> : null}
        {visual.variant === 'rhythm' ? <RhythmDots count={visual.count} activeIndex={visual.activeIndex} tone={tone} /> : null}
      </View>
      {showProjection && visual.projection ? (
        <View style={styles.projectionRow}>
          <Text style={styles.projectionLabel} numberOfLines={1}>{visual.projection.label}</Text>
          <Text style={styles.projectionValue} numberOfLines={1}>{visual.projection.value}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 9,
  },
  containerCompact: {
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  copyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    flex: 1,
  },
  valueChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  valueChipNeutral: { backgroundColor: colors.accentMuted },
  valueChipInfo: { backgroundColor: colors.infoMuted },
  valueChipWarning: { backgroundColor: colors.warningMuted },
  valueChipDanger: { backgroundColor: colors.dangerMuted },
  valueText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  visualBlock: {
    minHeight: 30,
    justifyContent: 'center',
  },
  paceWrap: {
    height: 28,
    justifyContent: 'center',
  },
  paceRail: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.surfacePressed,
    overflow: 'hidden',
  },
  paceFill: {
    height: '100%',
    borderRadius: 999,
  },
  paceOverflow: {
    position: 'absolute',
    right: 0,
    height: '100%',
    backgroundColor: colors.danger,
  },
  paceMarker: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: 17,
    borderRadius: 999,
    backgroundColor: colors.onDarkOverlayStrong,
  },
  projectionMarker: {
    position: 'absolute',
    top: -5,
    width: 3,
    height: 19,
    borderRadius: 999,
    backgroundColor: colors.warning,
  },
  sparkCanvas: {
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    alignSelf: 'flex-end',
  },
  sparkBaseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 2,
    height: 1,
    backgroundColor: colors.border,
  },
  sparkSegment: {
    position: 'absolute',
    height: 2,
    borderRadius: 999,
    transformOrigin: 'left center',
  },
  sparkDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  rhythmRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  rhythmDot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: 999,
    borderWidth: 1,
  },
  projectionRow: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  projectionLabel: {
    color: colors.textSubtle,
    fontSize: 11,
    flex: 1,
  },
  projectionValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    flex: 1,
  },
});
