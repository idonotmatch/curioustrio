const QUIET_INSIGHT_SEVERITIES = new Set(['low', 'info']);
const SENSITIVE_DATA_KEYS = new Set([
  'merchant',
  'merchant_name',
  'amount',
  'expense_id',
  'email_subject',
  'from_address',
  'message_id',
]);

function compactMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).filter(([key, value]) => (
    value != null && !SENSITIVE_DATA_KEYS.has(key)
  )));
}

function isActionableInsight(insight = {}) {
  if (!insight?.id || insight.state?.status === 'seen' || insight.state?.status === 'dismissed') return false;
  if (QUIET_INSIGHT_SEVERITIES.has(`${insight.severity || ''}`.toLowerCase())) return false;
  const metadata = insight.metadata || {};
  if (metadata.private === true || metadata.is_private === true) return false;
  if (metadata.confidence_label === 'early' || metadata.confidence === 'early') return false;
  return true;
}

function shouldSendInsightPush({ insight, sentIds = new Set(), sentContinuityKeys = new Set(), allowedTypes = new Set() } = {}) {
  if (!allowedTypes.has(insight?.type)) return { send: false, reason: 'unsupported_type' };
  if (!isActionableInsight(insight)) return { send: false, reason: 'not_actionable' };
  if (sentIds.has(insight.id)) return { send: false, reason: 'already_sent' };
  const continuityKey = insight?.metadata?.continuity_key || null;
  if (continuityKey && sentContinuityKeys.has(continuityKey)) return { send: false, reason: 'continuity_sent' };
  return { send: true, reason: 'eligible' };
}

function shouldSendGmailReviewPush({ imported = 0, pendingReview = 0, preferenceEnabled = true } = {}) {
  if (!preferenceEnabled) return { send: false, reason: 'preference_disabled' };
  if (Number(pendingReview || 0) <= 0) return { send: false, reason: 'nothing_actionable' };
  if (Number(imported || 0) <= 0) return { send: false, reason: 'nothing_imported' };
  return { send: true, reason: 'eligible' };
}

function safePushData(data = {}) {
  return compactMetadata(data);
}

module.exports = {
  compactMetadata,
  safePushData,
  shouldSendGmailReviewPush,
  shouldSendInsightPush,
};
