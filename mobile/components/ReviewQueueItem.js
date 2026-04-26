import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { DuplicateAlert } from './DuplicateAlert';
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
      accent: styles.modeChipQuick,
      accentText: styles.modeChipTextQuick,
    };
  }
  if (mode === 'items_first') {
    return {
      chipLabel: 'Items first',
      guidance: 'Review extracted items before approving.',
      approveLabel: 'Check items',
      accent: styles.modeChipItems,
      accentText: styles.modeChipTextItems,
    };
  }
  return {
    chipLabel: 'Review',
    guidance: 'Check merchant, date, and category.',
    approveLabel: 'Approve',
    accent: styles.modeChipFull,
    accentText: styles.modeChipTextFull,
  };
}

function pendingSourcePresentation(item = {}) {
  if (item?.review_source === 'gmail' || item?.source === 'email') {
    return {
      label: 'Gmail import',
      icon: 'mail-outline',
      accent: styles.sourceChipEmail,
      accentText: styles.sourceChipTextEmail,
    };
  }
  return {
    label: 'Pending',
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

export function ReviewQueueItem({
  item,
  onOpen,
  onApprove,
  onDismiss,
  variant = 'full',
}) {
  const mode = reviewModePresentation(item.gmail_review_hint);
  const source = pendingSourcePresentation(item);
  const quickCheck = isQuickCheckPending(item);
  const isPreview = variant === 'preview';
  const subject = reviewSubject(item);
  const itemCount = extractedItemCount(item);
  const rowTitle = subject
    ? (item.merchant || item.description || subject || '—')
    : reviewHeadline(item);

  const renderLeftActions = () => (
    <TouchableOpacity style={styles.approveAction} onPress={() => onApprove(item.id)}>
      <Ionicons name="checkmark" size={isPreview ? 16 : 20} color="#fff" />
      <Text style={styles.actionLabel}>{isPreview ? 'Approve' : mode.approveLabel}</Text>
    </TouchableOpacity>
  );

  const renderRightActions = () => (
    <TouchableOpacity style={styles.dismissAction} onPress={() => onDismiss(item.id)}>
      <Ionicons name="trash-outline" size={isPreview ? 16 : 20} color="#fff" />
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
        <TouchableOpacity style={isPreview ? styles.previewRow : styles.row} onPress={() => onOpen(item)} activeOpacity={0.85}>
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
                <View style={styles.metaRow}>
                  {!reviewSubject(item) ? (
                    <Text style={styles.date}>{formatDate(item.date)}</Text>
                  ) : null}
                  <View style={[styles.sourceChip, source.accent]}>
                    <Ionicons name={source.icon} size={11} color={source.accentText.color} />
                    <Text style={[styles.sourceChipText, source.accentText]}>{source.label}</Text>
                  </View>
                </View>
                {reviewSubject(item) ? (
                  <>
                    <Text style={styles.emailSubjectLabel}>Subject</Text>
                    <Text style={styles.emailSubject} numberOfLines={1}>
                      {reviewSubject(item)}
                    </Text>
                    <Text style={styles.emailContext} numberOfLines={1}>
                      {[item.merchant, reviewSubline(item)].filter(Boolean).join('  ·  ')}
                    </Text>
                  </>
                ) : null}
                {item.gmail_review_hint ? (
                  <View style={styles.hintWrap}>
                    <View style={styles.hintChipRow}>
                      <View style={[styles.modeChip, mode.accent]}>
                        <Text style={[styles.modeChipText, mode.accentText]}>{mode.chipLabel}</Text>
                      </View>
                      {itemCount > 0 ? (
                        <View style={styles.itemCountChip}>
                          <Text style={styles.itemCountChipText}>
                            {itemCount} item{itemCount === 1 ? '' : 's'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.hintDetail} numberOfLines={1}>{reviewQueueGuidance(item)}</Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
          <View style={isPreview ? styles.previewRowRight : styles.rowRight}>
            <Text style={isPreview ? styles.previewAmount : styles.amount}>${Number(item.amount).toFixed(2)}</Text>
            {quickCheck ? (
              <TouchableOpacity
                style={isPreview ? styles.previewConfirmChip : styles.confirmChip}
                onPress={(event) => {
                  event.stopPropagation?.();
                  onApprove(item.id);
                }}
                activeOpacity={0.82}
              >
                <Text style={isPreview ? styles.previewConfirmChipText : styles.confirmChipText}>Confirm</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </Swipeable>
      {!isPreview && item.duplicate_flags?.length > 0 ? (
        <DuplicateAlert flags={item.duplicate_flags} onDismiss={() => onDismiss(item.id)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a0a0a',
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  rowMain: { flex: 1, minWidth: 0, marginRight: 12 },
  merchant: { fontSize: 15, color: '#f5f5f5', fontWeight: '500' },
  date: { fontSize: 13, color: '#666', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  emailSubjectLabel: { marginTop: 6, fontSize: 10, color: '#6f6f6f', textTransform: 'uppercase', letterSpacing: 0.5 },
  emailSubject: { marginTop: 2, fontSize: 13, color: '#d6d6d6', fontWeight: '600' },
  emailContext: { marginTop: 3, fontSize: 12, color: '#737373' },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  sourceChipDefault: { backgroundColor: 'rgba(148,163,184,0.08)', borderColor: 'rgba(148,163,184,0.24)' },
  sourceChipEmail: { backgroundColor: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.3)' },
  sourceChipText: { fontSize: 11, fontWeight: '700' },
  sourceChipTextDefault: { color: '#cbd5e1' },
  sourceChipTextEmail: { color: '#93c5fd' },
  hintWrap: { marginTop: 6, gap: 4 },
  hintChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  modeChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  modeChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  modeChipQuick: { backgroundColor: 'rgba(134,239,172,0.08)', borderColor: 'rgba(134,239,172,0.35)' },
  modeChipTextQuick: { color: '#bbf7d0' },
  modeChipItems: { backgroundColor: 'rgba(253,224,71,0.08)', borderColor: 'rgba(253,224,71,0.35)' },
  modeChipTextItems: { color: '#fde68a' },
  modeChipFull: { backgroundColor: 'rgba(147,197,253,0.08)', borderColor: 'rgba(147,197,253,0.28)' },
  modeChipTextFull: { color: '#bfdbfe' },
  itemCountChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderColor: 'rgba(148,163,184,0.24)',
  },
  itemCountChipText: { fontSize: 11, fontWeight: '700', color: '#cbd5e1', letterSpacing: 0.2 },
  hintDetail: { fontSize: 12, color: '#8a8a8a' },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, flexShrink: 0, minWidth: 72 },
  amount: { fontSize: 15, color: '#f5f5f5', fontWeight: '600' },
  confirmChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.3)',
    backgroundColor: 'rgba(134,239,172,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  confirmChipText: { fontSize: 11, fontWeight: '700', color: '#bbf7d0' },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    width: '100%',
  },
  previewRowMain: { flex: 1, minWidth: 0, marginRight: 12 },
  previewMerchant: { fontSize: 14, color: '#f5f5f5' },
  previewSubjectLabel: { fontSize: 10, color: '#6f6f6f', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  previewSubject: { fontSize: 12, color: '#d6d6d6', fontWeight: '600', marginTop: 2 },
  previewMeta: { fontSize: 11, color: '#8faed8', marginTop: 3, fontWeight: '600' },
  previewGuidance: { fontSize: 12, color: '#8a8a8a', marginTop: 4 },
  previewRowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, flexShrink: 0, minWidth: 76 },
  previewAmount: { fontSize: 14, color: '#f5f5f5', fontWeight: '600' },
  previewConfirmChip: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.3)',
    backgroundColor: 'rgba(134,239,172,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  previewConfirmChipText: { color: '#bbf7d0', fontSize: 11, fontWeight: '700' },
  approveAction: {
    backgroundColor: '#22c55e',
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  dismissAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center', alignItems: 'center',
    width: 80, flexDirection: 'column', gap: 3,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  actionLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
