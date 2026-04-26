import { View, Text, TouchableOpacity } from 'react-native';

export function PendingExpenseItemsCard({
  styles,
  reviewItems,
  previewItems,
  hasMoreItems,
  activeReviewField,
  setItemsExpanded,
  activateReviewField,
  formatCurrency,
}) {
  if (!reviewItems.length) return null;

  const openItems = () => {
    setItemsExpanded(true);
    activateReviewField('items');
  };

  return (
    <View style={styles.priorityFieldsCard}>
      <View style={styles.priorityFieldsHeader}>
        <View style={styles.headerCopyBlock}>
          <Text style={styles.reviewSectionEyebrow}>Extracted items</Text>
          <Text style={styles.priorityFieldsTitle}>
            {reviewItems.length} {reviewItems.length === 1 ? 'item' : 'items'} found in the email
          </Text>
          <Text style={styles.reviewAttentionBody}>
            Check that the product names and amounts match what was actually ordered.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerActionWrap}
          onPress={openItems}
          activeOpacity={0.8}
        >
          <Text style={styles.priorityFieldsAction} numberOfLines={1}>Review</Text>
        </TouchableOpacity>
      </View>
      {previewItems.map((item, index) => (
        <TouchableOpacity
          key={`${item.description}:${index}`}
          style={[styles.priorityFieldRow, activeReviewField === 'items' && styles.priorityFieldRowActive]}
          onPress={openItems}
          activeOpacity={0.82}
        >
          <View style={styles.priorityFieldTop}>
            <Text style={styles.priorityFieldLabel}>{item.description}</Text>
            <Text style={styles.priorityFieldLabel}>
              {formatCurrency(item.amount) || '—'}
            </Text>
          </View>
          {item.brand ? <Text style={styles.priorityFieldReason}>{item.brand}</Text> : null}
        </TouchableOpacity>
      ))}
      {hasMoreItems ? (
        <TouchableOpacity
          style={styles.priorityFieldRow}
          onPress={openItems}
          activeOpacity={0.82}
        >
          <Text style={styles.priorityFieldsAction}>View all {reviewItems.length} items</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
