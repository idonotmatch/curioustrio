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
  const reviewReason = automationRecommendation?.reason || reviewFocusSummary.body;
  return (
    <View style={styles.reviewProvenanceCard}>
      <Text style={styles.reviewSectionEyebrow}>From email</Text>
      <Text style={styles.reviewProvenanceTitle}>
        {subjectLine || expenseMerchant || 'Gmail import awaiting review'}
      </Text>
      {importMetaBits.length ? <Text style={styles.reviewProvenanceMeta}>{importMetaBits.join('  ·  ')}</Text> : null}
      {reviewReason ? (
        <View style={styles.reviewReasonBlock}>
          <Text style={styles.reviewReasonLabel}>Why check this</Text>
          <Text style={styles.reviewReasonBody} numberOfLines={2}>{reviewReason}</Text>
        </View>
      ) : null}
      <View style={styles.reviewPathRow}>
        <Text style={styles.reviewProvenanceHint}>{primaryReviewPath}</Text>
      </View>
      {emailSnippet ? (
        <View style={styles.reviewSnippetBlock}>
          <Text style={styles.reviewSnippetLabel}>Email preview</Text>
          <Text style={styles.reviewProvenanceSnippet} numberOfLines={2}>{emailSnippet}</Text>
        </View>
      ) : null}
    </View>
  );
}
