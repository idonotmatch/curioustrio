export function reviewModeCountChips(summary = {}) {
  const breakdown = summary?.current_review_mode_breakdown || summary?.review_mode_breakdown || {};
  return [
    { key: 'quick_check', label: 'Quick confirm', count: breakdown.quick_check || 0 },
    { key: 'items_first', label: 'Item cleanup', count: breakdown.items_first || 0 },
    { key: 'full_review', label: 'Full review', count: breakdown.full_review || 0 },
  ].filter((entry) => entry.count > 0);
}

function getImportReasonMeta(reason) {
  const normalized = (reason || '').trim();
  switch (normalized) {
    case 'heuristic_skip': return { label: 'filtered', detail: null };
    case 'classifier_not_expense': return { label: 'not expense', detail: null };
    case 'classifier_uncertain': return { label: 'uncertain', detail: null };
    case 'missing_amount': return { label: 'missing amount', detail: null };
    case 'missing structured receipt': return { label: 'uncertain', detail: null };
    case 'Network error': return { label: 'failed', detail: null };
    default:
      if (!normalized) return { label: 'other', detail: null };
      if (normalized.includes('not a purchase') || normalized.includes('shipping') || normalized.includes('tracking')) {
        return { label: 'not expense', detail: normalized };
      }
      if (normalized.length > 32 || normalized.includes(' ')) {
        return { label: 'skipped', detail: normalized };
      }
      return { label: normalized.replace(/_/g, ' '), detail: null };
  }
}

export function summarizeReasonChips(reasons = []) {
  const grouped = new Map();
  for (const item of reasons) {
    const meta = getImportReasonMeta(item.reason);
    const existing = grouped.get(meta.label) || { label: meta.label, count: 0, rawReasons: new Set() };
    existing.count += item.count || 0;
    existing.rawReasons.add(item.reason);
    grouped.set(meta.label, existing);
  }
  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      detail: entry.rawReasons.size > 1 ? `${entry.rawReasons.size} reasons` : null,
    }));
}

export function formatLogStatus(entry) {
  if (entry.expense_status === 'confirmed') return 'reviewed';
  if (entry.expense_status === 'dismissed') return 'dismissed';
  if (entry.review_action === 'approved') return 'reviewed';
  if (entry.review_action === 'edited') return 'edited';
  if (entry.review_action === 'dismissed') return 'dismissed';
  if (entry.status === 'imported' && entry.review_source === 'gmail') {
    if (entry.review_required === false) return 'handled';
    const mode = entry.review_mode || 'full_review';
    if (mode === 'quick_check') return 'quick check';
    if (mode === 'items_first') return 'items first';
    return 'needs review';
  }
  if (entry.status === 'skipped') return getImportReasonMeta(entry.skip_reason).label;
  if (entry.status === 'failed') return 'failed';
  return entry.status;
}

export function formatLogDetail(entry) {
  if (entry.status === 'imported') return null;
  return getImportReasonMeta(entry.skip_reason).detail;
}

export function formatRelativeTime(value) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diffMs)) return null;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function formatSenderTrustLevel(level) {
  switch (level) {
    case 'trusted': return 'Usually accurate';
    case 'mixed': return 'Sometimes needs review';
    case 'noisy': return 'Usually needs review';
    default: return 'Still learning';
  }
}

export function formatSenderReviewPath(sender = {}) {
  const reliability = sender.review_path_reliability || {};
  if (sender.sender_preference?.force_review) return 'Always sent to review';
  if (reliability.fast_lane_eligible) return 'Usually ready for a quick confirmation';
  if ((reliability.items_first_count || 0) > 0) return 'Often needs item cleanup first';
  if ((reliability.full_review_count || 0) > 0) return 'Usually worth a closer review';
  if ((reliability.quick_check_count || 0) > 0) return 'Often lightweight to review';
  return 'Adlo is still learning this sender';
}

export function senderPolicyLabel(sender = {}) {
  if (sender.sender_preference?.force_review) return 'Always review';
  if (sender.review_path_reliability?.fast_lane_eligible) return 'Can often stay lightweight';
  return 'Adapts from your review history';
}

export function formatDismissReason(reason = '') {
  switch (`${reason}`) {
    case 'not_an_expense': return 'not an expense';
    case 'duplicate': return 'duplicate';
    case 'business_or_track_only': return 'business or track only';
    case 'transfer_or_payment': return 'transfer or payment';
    case 'wrong_details': return 'wrong details';
    case 'other': return 'other';
    default: return `${reason}`.replace(/_/g, ' ');
  }
}

export function formatTemplateLabel(pattern = '') {
  switch (pattern) {
    case 'amazon_order': return 'Amazon order';
    case 'amazon_shipping': return 'Amazon shipping';
    case 'amazon_refund': return 'Amazon refund';
    case 'generic_receipt': return 'Receipt';
    case 'generic_shipping': return 'Shipping update';
    case 'generic_refund': return 'Refund';
    case 'generic_payment': return 'Payment receipt';
    case 'generic_invoice': return 'Invoice';
    case 'generic_subscription': return 'Subscription';
    case 'generic_trip': return 'Trip or ride receipt';
    case 'generic_marketing': return 'Marketing';
    default: return `${pattern || 'Unknown template'}`.replace(/_/g, ' ');
  }
}

export function rankSenderCard(sender = {}) {
  if (sender.sender_preference?.force_review) return 0;
  if (sender.level === 'noisy') return 1;
  if (sender.level === 'mixed') return 2;
  if (sender.review_path_reliability?.fast_lane_eligible) return 4;
  if (sender.level === 'trusted') return 3;
  return 5;
}

export function learningSummaryLines(summary = {}, reasonChips = [], topDismissReasons = []) {
  const lines = [];
  const pendingReview = Number(summary?.current_pending_review ?? summary?.imported_pending_review ?? 0);
  const approvedWithoutChanges = Number(summary?.approved_without_changes || 0);
  const approvedAfterChanges = Number(summary?.approved_after_changes || 0);
  const skipped = Number(summary?.skipped || 0);

  if (approvedWithoutChanges > 0 || approvedAfterChanges > 0) {
    if (approvedWithoutChanges >= approvedAfterChanges) {
      lines.push('Most recent imports were close enough to approve with little or no cleanup.');
    } else {
      lines.push('Recent imports still often need edits before they are ready to approve.');
    }
  }

  if (pendingReview > 0) {
    lines.push(`${pendingReview} import${pendingReview === 1 ? ' is' : 's are'} waiting because Adlo still wanted your confirmation.`);
  }

  if (reasonChips.length > 0 && skipped > 0) {
    const top = reasonChips.slice(0, 2).map((item) => item.label).join(' and ');
    lines.push(`Recent filtering mostly removed ${top} messages before they reached your queue.`);
  }

  if (topDismissReasons.length > 0) {
    const top = topDismissReasons
      .slice(0, 2)
      .map((item) => formatDismissReason(item.reason))
      .join(' and ');
    lines.push(`When you dismiss Gmail imports, it is usually because they are ${top}.`);
  }

  return lines.slice(0, 3);
}

export function importHealthMessage(summary = {}) {
  const failed = Number(summary?.failed || 0);
  const pendingReview = Number(summary?.current_pending_review ?? summary?.imported_pending_review ?? 0);
  const imported = Number(summary?.imported || 0);
  if (failed > 0) return `${failed} recent import${failed === 1 ? '' : 's'} failed and may need another sync.`;
  if (pendingReview > 0) return `${pendingReview} Gmail import${pendingReview === 1 ? '' : 's'} still need your review.`;
  if (imported > 0) return 'Recent Gmail imports are coming through normally.';
  return 'No recent Gmail activity yet.';
}

function formatSyncSource(source) {
  if (source === 'manual') return 'manual refresh';
  if (source === 'scheduler') return 'background refresh';
  return 'sync';
}

export function syncStatusMessage(status = {}, summary = {}) {
  const lastSuccess = formatRelativeTime(summary?.last_synced_at || status?.last_synced_at);
  const lastAttempt = formatRelativeTime(summary?.last_sync_attempted_at || status?.last_sync_attempted_at);
  const lastError = summary?.last_sync_error || status?.last_sync_error;
  const source = summary?.last_sync_source || status?.last_sync_source;
  const syncStatus = summary?.last_sync_status || status?.last_sync_status;

  if (syncStatus === 'failed' && lastAttempt) {
    return `Last ${formatSyncSource(source)} failed ${lastAttempt}.`;
  }
  if (lastSuccess) {
    return `Last ${formatSyncSource(source)} ${lastSuccess}.`;
  }
  if (lastAttempt) {
    return `Last ${formatSyncSource(source)} was ${lastAttempt}.`;
  }
  if (lastError) {
    return 'Gmail sync hit an issue before finishing.';
  }
  return null;
}

export function syncErrorMessage(status = {}, summary = {}) {
  const lastError = summary?.last_sync_error || status?.last_sync_error;
  if (!lastError) return null;
  const normalized = `${lastError}`.trim();
  if (!normalized) return null;
  if (normalized.length <= 90) return normalized;
  return `${normalized.slice(0, 87)}...`;
}
