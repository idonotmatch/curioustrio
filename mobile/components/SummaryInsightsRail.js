import { memo, useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { InsightCard } from './InsightCard';

function SummaryInsightsRailBase({
  styles,
  displayInsights,
  loading = false,
  insightsError,
  refreshInsights,
  hasMultipleInsights,
  insightCardWidth,
  handlePressInsight,
  handleActionInsight,
  handleDismissInsight,
  openingInsightId,
  title = 'Insights',
  hint,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  if (!(displayInsights.length > 0 || insightsError || loading)) return null;
  const snapInterval = insightCardWidth + 12;
  const activeIndex = Math.max(0, Math.min(currentIndex, Math.max(displayInsights.length - 1, 0)));
  const handleScroll = useCallback((event) => {
    if (!hasMultipleInsights) return;
    const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
    const nextIndex = Math.max(0, Math.min(
      displayInsights.length - 1,
      Math.round(offsetX / snapInterval)
    ));
    setCurrentIndex((current) => (nextIndex !== current ? nextIndex : current));
  }, [displayInsights.length, hasMultipleInsights, snapInterval]);

  return (
    <View style={styles.insightsSection}>
      <View style={styles.insightsHeading}>
        <Text style={styles.sectionLabel}>{title}</Text>
        {displayInsights.length > 1 ? (
          <Text style={styles.insightsHint}>{`${activeIndex + 1} of ${displayInsights.length} | ${hint || 'Swipe for more'}`}</Text>
        ) : null}
      </View>
      {insightsError ? (
        <TouchableOpacity style={styles.insightsErrorCard} onPress={refreshInsights} activeOpacity={0.85}>
          <Text style={styles.insightsErrorTitle}>Could not load insights</Text>
          <Text style={styles.insightsErrorBody}>{insightsError}</Text>
          <Text style={styles.insightsErrorAction}>Tap to retry</Text>
        </TouchableOpacity>
      ) : null}
      {loading && displayInsights.length === 0 && !insightsError ? (
        <View style={[styles.insightSkeletonCard, { width: insightCardWidth }]}>
          <View style={styles.insightSkeletonMetaRow}>
            <View style={styles.insightSkeletonChip} />
            <View style={styles.insightSkeletonChipShort} />
          </View>
          <View style={styles.insightSkeletonTitle} />
          <View style={styles.insightSkeletonTitleShort} />
          <View style={styles.insightSkeletonBody} />
          <View style={styles.insightSkeletonBodyShort} />
          <View style={styles.insightSkeletonFooter} />
        </View>
      ) : null}
      {displayInsights.length > 0 ? (
      <ScrollView
        horizontal
        scrollEnabled={hasMultipleInsights}
        showsHorizontalScrollIndicator={false}
        snapToInterval={hasMultipleInsights ? snapInterval : undefined}
        snapToAlignment="start"
        decelerationRate={hasMultipleInsights ? 'fast' : 'normal'}
        disableIntervalMomentum={hasMultipleInsights}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.insightsRail,
          !hasMultipleInsights && styles.insightsRailSingle,
        ]}
      >
        {displayInsights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            width={insightCardWidth}
            onPress={handlePressInsight}
            onAction={handleActionInsight}
            onDismiss={handleDismissInsight}
            disabled={Boolean(openingInsightId)}
            emphasis={displayInsights[0]?.id === insight.id ? 'primary' : 'default'}
          />
        ))}
      </ScrollView>
      ) : null}
      {displayInsights.length > 1 ? (
        <View style={styles.insightsDots}>
          {displayInsights.map((insight, index) => (
            <View
              key={insight.id}
              style={[
                styles.insightsDot,
                index === activeIndex && styles.insightsDotActive,
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const SummaryInsightsRail = memo(SummaryInsightsRailBase);
