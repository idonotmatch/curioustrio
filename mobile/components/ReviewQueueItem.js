import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { DuplicateAlert } from './DuplicateAlert';
import { colors } from '../theme/tokens';
import { reviewReasonSummary, sourcePresentation } from '../services/provenancePresentation';
const { decodeHtmlEntities } = require('../services/text');

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.slice(0, 10) + 'T12:00:00';
  const date = new Date(clean);
  if (isNaN(date)) return dateStr;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function reviewModePresentation(hint = {}) {
  const mode = hint?.review_mode || 'full_review';
  if (mode === 'quick_check') {
    return {
      chipLabel: 'Quick check',
      guidance: 'Check merchant, amount, and date.',
      approveLabel: 'Quick approve',
      primaryLabel: 'Confirm',
      accent: styles.modeChipQuick,
      accentText: styles.modeChipTextQuick,
    };
  }
  if (mode === 'items_first') {
    return {
      chipLabel: 'Items first',
      guidance: 'Review extracted items before approving.',
      approveLabel: 'Check items',
      primaryLabel: 'Check items',
      accent: styles.modeChipItems,
      accentText: styles.modeChipTextItems,
    };
  }
  return {
    chipLabel: 'Details check',
    guidance: 'Check merchant, date, and category.',
    approveLabel: 'Approve',
    primaryLabel: 'Review',
    accent: styles.modeChipFull,
    accentText: styles.modeChipTextFull,
  };
}

function likelyFieldLabels(item = {}) {
  const fields = Array.isArray(item?.gmail_review_hint?.likely_changed_fields)
    ? item.gmail_review_hint.likely_changed_fields.filter(Boolean)
    : [];
  return fields.map((field) => `${field}`.replace('_id', '').replace(/_/g, ' '));
}

function pendingSourcePresentation(item = {}) {
  const provenance = sourcePresentation(item);
  if (provenance.label === 'Gmail import') {
    return {
      label: provenance.label,
      icon: 'mail-outline',
      accent: styles.sourceChipEmail,
      accentText: styles.sourceChipTextEmail,
    };
  }
  return {
    label: provenance.label || 'Pending',
    icon: 'time-outline',
    accent: styles.sourceChipDefault,
    accentText: styles.sourceChipTextDefault,
  };
}

function isQuickCheckPending(item = {}) {
  if (item?.gmail_review_hint?.review_mode !== 'quick_check') return false;
  if (Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0) return false;
  const likelyChangedFields = Array.isArray(item?.gmail_review_hint?.likely_changed_fields)
    ? item.gmail_review_hint.likely_changed_fields.filter(Boolean)
    : [];
  return likelyChangedFields.length <= 1;
}

function extractedItemCount(item = {}) {
  const explicitCount = Math.max(0, Number(item?.item_count || 0));
  if (Array.isArray(item?.items)) return Math.max(item.items.length, explicitCount);
  return explicitCount;
}

function reviewHeadline(item = {}) {
  const subject = decodeHtmlEntities(`${item?.gmail_review_hint?.message_subject || item?.email_subject || ''}`).trim();
  if (subject) return subject;
  return item.merchant || item.description || '—';
}

function reviewSubline(item = {}) {
  const parts = [];
  if (item?.gmail_review_hint?.from_address || item?.email_from_address) {
    parts.push(item?.gmail_review_hint?.from_address || item?.email_from_address);
  }
  const date = formatDate(item?.date);
  if (date) parts.push(date);
  return parts.join('  ·  ');
}

function reviewSubject(item = {}) {
  return decodeHtmlEntities(`${item?.gmail_review_hint?.message_subject || item?.email_subject || ''}`).trim();
}

export function reviewQueueGuidance(item = {}) {
  if (Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0) {
    return 'Possible duplicate. Compare before approving.';
  }
  if (item?.gmail_review_hint?.review_mode === 'items_first') {
    const itemCount = extractedItemCount(item);
    return itemCount > 0
      ? `Review ${itemCount} extracted item${itemCount === 1 ? '' : 's'} before approving.`
      : 'Review extracted items before approving.';
  }
  const likelyFields = likelyFieldLabels(item);
  if (likelyFields.length > 0 && item?.gmail_review_hint?.review_mode !== 'quick_check') {
    return `${likelyFields.slice(0, 2).join(' or ')} may need correction.`;
  }
  const reason = reviewReasonSummary(item);
  if (reason) return reason;
  const automationReason = `${item?.gmail_review_hint?.automation_recommendation?.reason || ''}`.trim();
  if (automationReason) return automationReason;
  const itemCount = extractedItemCount(item);
  if (item?.gmail_review_hint?.review_mode === 'items_first' && itemCount > 0) {
    return `Review ${itemCount} extracted item${itemCount === 1 ? '' : 's'} before approving.`;
  }
  return reviewModePresentation(item.gmail_review_hint).guidance;
}

export function reviewQueueLabel(item = {}) {
  if (item?.review_source === 'gmail' || item?.source === 'email') {
    const automationLabel = `${item?.gmail_review_hint?.automation_recommendation?.label || ''}`.trim();
    if (automationLabel) return `Gmail import · ${automationLabel}`;
    const mode = item?.gmail_review_hint?.review_mode;
    if (mode === 'quick_check') return 'Gmail import · Quick check';
    if (mode === 'items_first') return 'Gmail import · Items first';
    return 'Gmail import · Review';
  }
  return 'Pending review';
}

export function reviewQueueGroup(item = {}) {
  if (Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0) {
    return { key: 'duplicates', title: 'Possible duplicates', priority: 0 };
  }
  if (item?.gmail_review_hint?.review_mode === 'items_first') {
    return { key: 'items', title: 'Check items', priority: 1 };
  }
  if (isQuickCheckPending(item)) {
    return { key: 'quick', title: 'Quick confirms', priority: 2 };
  }
  return { key: 'review', title: 'Needs review', priority: 3 };
}

function reviewQueueCta(item = {}) {
  if (Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0) return 'Compare';
  if (item?.gmail_review_hint?.review_mode === 'items_first') return 'Check items';
  const likelyFields = likelyFieldLabels(item);
  if (likelyFields.length > 0 && item?.gmail_review_hint?.review_mode !== 'quick_check') return 'Edit & approve';
  if (isQuickCheckPending(item)) return 'Confirm';
  return 'Review';
}

export function ReviewQueueItem({
  item,
  onOpen,
  onApprove,
  onDismiss,
  variant = 'full',
  disabled = false,
}) {
  const mode = reviewModePresentation(item.gmail_review_hint);
  const source = pendingSourcePresentation(item);
  const quickCheck = isQuickCheckPending(item);
  const hasDuplicateFlags = Array.isArray(item?.duplicate_flags) && item.duplicate_flags.length > 0;
  const isPreview = variant === 'preview';
  const subject = reviewSubject(item);
  const itemCount = extractedItemCount(item);
  const guidance = reviewQueueGuidance(item);
  const reasonSummary = reviewReasonSummary(item);
  const ctaLabel = reviewQueueCta(item);
  const metadataParts = [
    source.label,
    itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : null,
    formatDate(item?.date),
  ].filter(Boolean);
  const rowTitle = subject
    ? (item.merchant || item.description || subject || '—')
    : reviewHeadline(item);
  const primaryAction = () => {
    if (disabled) return;
    if (quickCheck && ctaLabel === 'Confirm') onApprove(item.id);
    else onOpen(item);
  };

  const renderLeftActions = () => (
    <TouchableOpacity
      style={[styles.approveAction, disabled ? styles.actionDisabled : null]}
      onPress={() => {
        if (!disabled) {
          if (hasDuplicateFlags) onOpen(item);
          else onApprove(item.id);
        }
      }}
      disabled={disabled}
    >
      <Ionicons name={hasDuplicateFlags ? 'git-compare-outline' : 'checkmark'} size={isPreview ? 16 : 20} color={colors.text} />
      <Text style={styles.actionLabel}>{hasDuplicateFlags ? 'Compare' : isPreview ? 'Approve' : mode.approveLabel}</Text>
    </TouchableOpacity>
  );

  const renderRightActions = () => (
    <TouchableOpacity
      style={[styles.dismissAction, disabled ? styles.actionDisabled : null]}
      onPress={() => {
        if (!disabled) onDismiss(item.id);
      }}
      disabled={disabled}
    >
      <Ionicons name="trash-outline" size={isPreview ? 16 : 20} color={colors.text} />
      <Text style={styles.actionLabel}>Dismiss</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <Swipeable
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        overshootLeft={false}
        overshootRight={false}
      >
        <TouchableOpacity
          style={isPreview ? styles.previewRow : styles.row}
          onPress={() => {
            if (!disabled) onOpen(item);
          }}
          activeOpacity={0.85}
          disabled={disabled}
        >
          <View style={isPreview ? styles.previewRowMain : styles.rowMain}>
            <Text style={isPreview ? styles.previewMerchant : styles.merchant} numberOfLines={1}>
              {rowTitle}
            </Text>
            {isPreview ? (
              <>
                {subject ? (
                  <Text style={styles.previewMeta} numberOfLines={1}>
                    {[subject, item?.gmail_review_hint?.from_address || item?.email_from_address].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
                <Text style={styles.previewMeta} numberOfLines={1}>{reviewQueueLabel(item)}</Text>
                <Text style={styles.previewGuidance} numberOfLines={1}>{reviewQueueGuidance(item)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.reviewReason} numberOfLines={2}>{guidance || reasonSummary}</Text>
                <Text style={styles.emailContext} numberOfLines={1}>
                  {metadataParts.join('  ·  ')}
                </Text>
              </>
            )}
          </View>
          <View style={isPreview ? styles.previewRowRight : styles.rowRight}>
            <Text style={isPreview ? styles.previewAmount : styles.amount}>${Number(item.amount).toFixed(2)}</Text>
            {!isPreview ? (
              <TouchableOpacity
                style={[styles.confirmChip, disabled ? styles.actionDisabled : null]}
                onPress={(event) => {
                  event.stopPropagation?.();
                  primaryAction();
                }}
                activeOpacity={0.82}
                disabled={disabled}
              >
                <Text style={styles.confirmChipText}>{ctaLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </Swipeable>
      {!isPreview && item.duplicate_flags?.length > 0 ? (
        <DuplicateAlert
          flags={item.duplicate_flags}
          onCompare={() => {
            if (!disabled) onOpen(item);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: colors.surface,
  },
  rowMain: { flex: 1, minWidth: 0, marginRight: 12 },
  merchant: { fontSize: 15, color: colors.text, fontWeight: '500' },
  date: { fontSize: 13, color: colors.textDisabled, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  emailSubject: { marginTop: 4, fontSize: 12, color: colors.textDisabled, fontWeight: '500' },
  emailContext: { marginTop: 3, fontSize: 12, color: colors.textDisabled },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  sourceChipDefault: { backgroundColor: colors.neutralWash, borderColor: colors.neutralWashBorder },
  sourceChipEmail: { backgroundColor: colors.infoMuted, borderColor: colors.infoBorder },
  sourceChipText: { fontSize: 11, fontWeight: '700' },
  sourceChipTextDefault: { color: colors.text },
  sourceChipTextEmail: { color: colors.info },
  hintWrap: { marginTop: 5, gap: 2 },
  hintChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  modeChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  modeChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  modeChipQuick: { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
  modeChipTextQuick: { color: colors.success },
  modeChipItems: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  modeChipTextItems: { color: colors.warning },
  modeChipFull: { backgroundColor: colors.infoMuted, borderColor: colors.infoBorder },
  modeChipTextFull: { color: colors.info },
  itemCountChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    backgroundColor: colors.neutralWash,
    borderColor: colors.neutralWashBorder,
  },
  itemCountChipText: { fontSize: 11, fontWeight: '700', color: colors.text, letterSpacing: 0.2 },
  hintDetail: { fontSize: 12, color: colors.textSubtle },
  reviewReason: { marginTop: 5, fontSize: 13, color: colors.textSubtle, lineHeight: 18, fontWeight: '600' },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 8, flexShrink: 0, minWidth: 104 },
  amount: { fontSize: 15, color: colors.text, fontWeight: '600' },
  confirmChip: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    backgroundColor: colors.infoMuted,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  confirmChipText: { fontSize: 11, fontWeight: '700', color: colors.info },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    width: '100%',
  },
  previewRowMain: { flex: 1, minWidth: 0, marginRight: 12 },
  previewMerchant: { fontSize: 14, color: colors.text },
  previewSubjectLabel: { fontSize: 10, color: colors.textDisabled, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  previewSubject: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  previewMeta: { fontSize: 11, color: colors.info, marginTop: 3, fontWeight: '600' },
  previewGuidance: { fontSize: 12, color: colors.textSubtle, marginTop: 4 },
  previewRowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, flexShrink: 0, minWidth: 76 },
  previewAmount: { fontSize: 14, color: colors.text, fontWeight: '600' },
  previewConfirmChip: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successMuted,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  previewConfirmChipText: { color: colors.success, fontSize: 11, fontWeight: '700' },
  approveAction: {
    backgroundColor: colors.success,
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: colors.surface,
  },
  dismissAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: colors.surface,
  },
  actionLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  actionDisabled: { opacity: 0.55 },
});
