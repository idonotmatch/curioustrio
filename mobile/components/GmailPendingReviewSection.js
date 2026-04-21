import { View, Text, TouchableOpacity } from 'react-native';

export function GmailPendingReviewSection({
  styles,
  displayGmailStatus,
  displayPendingReviewItems,
  pendingReviewError,
  openReviewQueue,
  openExpenseReview,
}) {
  if (!displayGmailStatus?.connected) return null;

  return (
    <View style={styles.section}>
      <View style={styles.logToggleRow}>
        <Text style={styles.sectionTitle}>AWAITING YOUR REVIEW</Text>
        {displayPendingReviewItems.length > 0 ? (
          <TouchableOpacity onPress={openReviewQueue} activeOpacity={0.75}>
            <Text style={styles.openQueueLink}>Open queue</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {displayPendingReviewItems.length === 0 ? (
        <Text style={styles.emptyText}>
          {pendingReviewError || 'No Gmail imports are currently waiting in your review queue.'}
        </Text>
      ) : (
        displayPendingReviewItems.slice(0, 3).map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.pendingRow}
            activeOpacity={0.82}
            onPress={() => openExpenseReview(item)}
          >
            <View style={styles.pendingRowMain}>
              <Text style={styles.pendingMerchant} numberOfLines={1}>
                {item.gmail_review_hint?.message_subject || item.email_subject || item.merchant || item.description || '(no merchant)'}
              </Text>
              {(item.gmail_review_hint?.message_subject || item.email_subject) ? (
                <Text style={styles.pendingMeta} numberOfLines={1}>
                  {[item.merchant, item.gmail_review_hint?.from_address || item.email_from_address].filter(Boolean).join('  ·  ')}
                </Text>
              ) : null}
              <Text style={styles.pendingMeta} numberOfLines={1}>
                {item.gmail_review_hint?.review_mode === 'quick_check'
                  ? 'Quick check'
                  : item.gmail_review_hint?.review_mode === 'items_first'
                    ? 'Items first'
                    : 'Review'}
              </Text>
            </View>
            <View style={styles.pendingRowRight}>
              <Text style={styles.pendingAmount}>${Number(item.amount || 0).toFixed(2)}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
