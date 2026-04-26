import { View, Text } from 'react-native';

export function PendingExpenseEmailCard({
  styles,
  subjectLine,
  expenseMerchant,
  importMetaBits,
  automationRecommendation,
  reviewFocusSummary,
  primaryReviewPath,
  emailSnippet,
}) {
  return (
    <View style={styles.reviewProvenanceCard}>
      <Text style={styles.reviewSectionEyebrow}>From email</Text>
      <Text style={styles.reviewProvenanceTitle}>
        {subjectLine || expenseMerchant || 'Gmail import awaiting review'}
      </Text>
      {importMetaBits.length ? <Text style={styles.reviewProvenanceMeta}>{importMetaBits.join('  ·  ')}</Text> : null}
      <Text style={styles.reviewProvenanceSnippet} numberOfLines={1}>
        {automationRecommendation?.reason || reviewFocusSummary.body}
      </Text>
      <Text style={styles.reviewProvenanceHint}>{primaryReviewPath}</Text>
      {emailSnippet ? <Text style={styles.reviewProvenanceSnippet} numberOfLines={1}>{emailSnippet}</Text> : null}
    </View>
  );
}
