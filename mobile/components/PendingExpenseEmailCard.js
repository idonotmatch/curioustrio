import { View, Text } from 'react-native';
import { StatusChip } from './ui/StatusChip';

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
      <View style={styles.reviewProvenanceHeader}>
        <Text style={styles.reviewSectionEyebrow}>From email</Text>
        <StatusChip label={primaryReviewPath} tone={primaryReviewPath?.toLowerCase?.().includes('quick') ? 'success' : 'warning'} />
      </View>
      <Text style={styles.reviewProvenanceTitle}>{subjectLine || expenseMerchant || 'Gmail import awaiting review'}</Text>
      {importMetaBits.length ? <Text style={styles.reviewProvenanceMeta}>{importMetaBits.join('  ·  ')}</Text> : null}
      {reviewReason ? (
        <View style={styles.reviewReasonBlock}>
          <Text style={styles.reviewReasonLabel}>Why check this</Text>
          <Text style={styles.reviewReasonBody} numberOfLines={2}>{reviewReason}</Text>
        </View>
      ) : null}
      {emailSnippet ? (
        <View style={styles.reviewSnippetBlock}>
          <Text style={styles.reviewSnippetLabel}>Email preview</Text>
          <Text style={styles.reviewProvenanceSnippet} numberOfLines={2}>{emailSnippet}</Text>
        </View>
      ) : null}
    </View>
  );
}
