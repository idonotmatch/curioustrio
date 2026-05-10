import { View, Text, TouchableOpacity } from 'react-native';
import { EmptyState, InlineError, SectionHeader } from './ui/States';
import { StatusChip } from './ui/StatusChip';
const { decodeHtmlEntities } = require('../services/text');

function extractedItemCount(item = {}) {
  const explicitCount = Math.max(0, Number(item?.item_count || 0));
  if (Array.isArray(item?.items)) return Math.max(item.items.length, explicitCount);
  return explicitCount;
}

function reviewSubject(item = {}) {
  return decodeHtmlEntities(`${item.gmail_review_hint?.message_subject || item.email_subject || ''}`).trim();
}

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
      <SectionHeader
        eyebrow="Gmail"
        title="Awaiting your review"
        body={displayPendingReviewItems.length > 0 ? 'Imports that need a decision before they count as done.' : null}
        actionLabel={displayPendingReviewItems.length > 0 ? 'Open queue' : null}
        onAction={displayPendingReviewItems.length > 0 ? openReviewQueue : null}
      />
      {pendingReviewError ? (
        <InlineError title="Could not load review queue" body={pendingReviewError} />
      ) : null}
      {displayPendingReviewItems.length === 0 ? (
        <EmptyState
          compact
          icon="checkmark-circle-outline"
          title="No Gmail imports waiting"
          body="New imports that need confirmation will appear here."
        />
      ) : (
        displayPendingReviewItems.slice(0, 3).map((item) => {
          const itemCount = extractedItemCount(item);
          const reviewMode = item.gmail_review_hint?.review_mode === 'quick_check'
            ? 'Quick check'
            : item.gmail_review_hint?.review_mode === 'items_first'
              ? 'Items first'
              : 'Review';
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.pendingRow}
              activeOpacity={0.82}
              onPress={() => openExpenseReview(item)}
            >
              <View style={styles.pendingRowMain}>
                <Text style={styles.pendingMerchant} numberOfLines={1}>
                  {reviewSubject(item) || item.merchant || item.description || '(no merchant)'}
                </Text>
                {reviewSubject(item) ? (
                  <Text style={styles.pendingMeta} numberOfLines={1}>
                    {[item.merchant, item.gmail_review_hint?.from_address || item.email_from_address].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
                <Text style={styles.pendingMeta} numberOfLines={1}>
                  {[
                    itemCount > 0 ? `${itemCount} extracted item${itemCount === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <View style={styles.pendingRowRight}>
                <StatusChip label={reviewMode} tone={reviewMode === 'Quick check' ? 'success' : reviewMode === 'Items first' ? 'warning' : 'info'} />
                <Text style={styles.pendingAmount}>${Number(item.amount || 0).toFixed(2)}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}
