import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function PendingExpenseAttentionCard({
  styles,
  attentionFields,
  editing,
  activateReviewField,
  activeReviewField,
  reviewFocusSummary,
  categoryDetail,
}) {
  if (!attentionFields.length) return null;

  return (
    <View style={styles.priorityFieldsCard}>
      <View style={styles.priorityFieldsHeader}>
        <View style={styles.headerCopyBlock}>
          <Text style={styles.reviewSectionEyebrow}>Double-check first</Text>
          <Text style={styles.priorityFieldsTitle}>{reviewFocusSummary.title}</Text>
          <Text style={styles.reviewAttentionBody}>{reviewFocusSummary.body}</Text>
        </View>
        {!editing ? (
          <TouchableOpacity style={styles.headerActionWrap} onPress={() => activateReviewField(attentionFields[0]?.key || 'amount')} activeOpacity={0.8}>
            <Text style={styles.priorityFieldsAction} numberOfLines={1}>Review</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {attentionFields.map((field) => (
        <TouchableOpacity
          key={field.key}
          style={[styles.priorityFieldRow, activeReviewField === field.key && styles.priorityFieldRowActive]}
          onPress={() => activateReviewField(field.key)}
          activeOpacity={0.82}
        >
          <View style={styles.priorityFieldTop}>
            <Text style={styles.priorityFieldLabel}>{field.label}</Text>
            <Ionicons name="chevron-forward" size={14} color="#5f6b7a" />
          </View>
          <Text style={styles.priorityFieldValue}>{field.value}</Text>
          <Text style={styles.priorityFieldReason}>
            {field.key === 'category' && categoryDetail ? categoryDetail : field.reason}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
