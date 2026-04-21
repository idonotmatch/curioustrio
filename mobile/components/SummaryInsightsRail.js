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
}) {
  if (!(displayInsights.length > 0 || insightsError)) return null;

  return (
    <View style={styles.insightsSection}>
      <View style={styles.insightsHeading}>
        <Text style={styles.sectionLabel}>Insights</Text>
        {displayInsights.length > 1 ? (
          <Text style={styles.insightsHint}>Swipe for more</Text>
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
          />
        ))}
      </ScrollView>
    </View>
  );
}
