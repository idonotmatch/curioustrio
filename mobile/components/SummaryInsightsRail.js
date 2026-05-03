import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { InsightCard } from './InsightCard';

export function SummaryInsightsRail({
  styles,
  displayInsights,
  insightsError,
  refreshInsights,
  hasMultipleInsights,
  insightCardWidth,
  handlePressInsight,
  handleDismissInsight,
  openingInsightId,
  title = 'Insights',
  hint,
}) {
  if (!(displayInsights.length > 0 || insightsError)) return null;
  const [currentIndex, setCurrentIndex] = useState(0);
  const snapInterval = insightCardWidth + 12;
  const activeIndex = Math.max(0, Math.min(currentIndex, Math.max(displayInsights.length - 1, 0)));

  return (
    <View style={styles.insightsSection}>
      <View style={styles.insightsHeading}>
        <Text style={styles.sectionLabel}>{title}</Text>
        {displayInsights.length > 1 ? (
          <Text style={styles.insightsHint}>{`${activeIndex + 1} of ${displayInsights.length} · ${hint || 'Swipe for more'}`}</Text>
        ) : null}
      </View>
      {insightsError ? (
        <TouchableOpacity style={styles.insightsErrorCard} onPress={refreshInsights} activeOpacity={0.85}>
          <Text style={styles.insightsErrorTitle}>Couldn’t load insights</Text>
          <Text style={styles.insightsErrorBody}>{insightsError}</Text>
          <Text style={styles.insightsErrorAction}>Tap to retry</Text>
        </TouchableOpacity>
      ) : null}
      <ScrollView
        horizontal
        scrollEnabled={hasMultipleInsights}
        showsHorizontalScrollIndicator={false}
        snapToInterval={hasMultipleInsights ? snapInterval : undefined}
        snapToAlignment="start"
        decelerationRate={hasMultipleInsights ? 'fast' : 'normal'}
        disableIntervalMomentum={hasMultipleInsights}
        onScroll={(event) => {
          if (!hasMultipleInsights) return;
          const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
          const nextIndex = Math.max(0, Math.min(
            displayInsights.length - 1,
            Math.round(offsetX / snapInterval)
          ));
          if (nextIndex !== currentIndex) setCurrentIndex(nextIndex);
        }}
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
            onDismiss={handleDismissInsight}
            disabled={Boolean(openingInsightId)}
            emphasis={displayInsights[0]?.id === insight.id ? 'primary' : 'default'}
          />
        ))}
      </ScrollView>
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
