const EmailImportLog = require('../models/emailImportLog');

function extractSenderDomain(fromAddress = '') {
  const match = `${fromAddress || ''}`.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || 'unknown';
}

function toRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function isItemField(field = '') {
  return `${field}`.startsWith('items');
}

function summarizeItemReliability(rows = []) {
  const imports = rows.length;
  const itemFieldCounts = new Map();
  let itemEdited = 0;

  for (const row of rows) {
    const changedFields = Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [];
    const itemFields = changedFields.filter(isItemField);
    if (itemFields.length) itemEdited += 1;
    for (const field of itemFields) {
      itemFieldCounts.set(field, (itemFieldCounts.get(field) || 0) + 1);
    }
  }

  const editRate = toRate(itemEdited, imports);
  let level = 'unknown';
  if (imports >= 3) {
    if (editRate <= 0.15) level = 'trusted';
    else if (editRate >= 0.5) level = 'noisy';
    else level = 'mixed';
  }

  const topSignals = [...itemFieldCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([field, count]) => ({ field, count }));

  let message = null;
  if (level === 'trusted') {
    message = 'Line items from this sender are usually usable as-is.';
  } else if (level === 'mixed') {
    message = 'Line items from this sender sometimes need cleanup.';
  } else if (level === 'noisy') {
    message = 'Line items from this sender often need cleanup before approval.';
  }

  return {
    level,
    imports,
    edited: itemEdited,
    edit_rate: editRate,
    top_signals: topSignals,
    message,
  };
}

function summarizeSenderRows(rows = []) {
  const imported = rows.length;
  let reviewed = 0;
  let cleanApproved = 0;
  let approvedAfterChanges = 0;
  let dismissed = 0;
  let edited = 0;

  for (const row of rows) {
    const editCount = Number(row.review_edit_count || 0);
    const hasReview = !!row.review_action || editCount > 0;
    if (hasReview) reviewed += 1;
    if (row.review_action === 'dismissed') dismissed += 1;
    if (row.review_action === 'approved' && editCount === 0) cleanApproved += 1;
    if (row.review_action === 'approved' && editCount > 0) approvedAfterChanges += 1;
    if (editCount > 0) edited += 1;
  }

  return {
    imported,
    reviewed,
    clean_approved: cleanApproved,
    approved_after_changes: approvedAfterChanges,
    dismissed,
    edited,
    clean_approval_rate: toRate(cleanApproved, imported),
    dismissal_rate: toRate(dismissed, imported),
    edit_rate: toRate(edited, imported),
    review_rate: toRate(reviewed, imported),
  };
}

function buildSenderSummary(rows, limit = 5) {
  const grouped = new Map();

  for (const row of rows) {
    const senderDomain = extractSenderDomain(row.from_address);
    const current = grouped.get(senderDomain) || {
      sender_domain: senderDomain,
      imported: 0,
      reviewed: 0,
      clean_approved: 0,
      approved_after_changes: 0,
      dismissed: 0,
      edited: 0,
      top_changed_fields: [],
    };

    current.imported += 1;
    const editCount = Number(row.review_edit_count || 0);
    const changedFields = Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [];
    const hasReview = !!row.review_action || editCount > 0;
    if (hasReview) current.reviewed += 1;
    if (row.review_action === 'dismissed') current.dismissed += 1;
    if (row.review_action === 'approved' && editCount === 0) current.clean_approved += 1;
    if (row.review_action === 'approved' && editCount > 0) current.approved_after_changes += 1;
    if (editCount > 0) {
      current.edited += 1;
      current._changedFieldCounts = current._changedFieldCounts || new Map();
      for (const field of changedFields) {
        current._changedFieldCounts.set(field, (current._changedFieldCounts.get(field) || 0) + 1);
      }
    }

    grouped.set(senderDomain, current);
  }

  return [...grouped.values()]
    .map((entry) => {
      const changedFieldCounts = [...(entry._changedFieldCounts || new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([field, count]) => ({ field, count }));
      delete entry._changedFieldCounts;
      return {
        ...entry,
        clean_approval_rate: toRate(entry.clean_approved, entry.imported),
        dismissal_rate: toRate(entry.dismissed, entry.imported),
        edit_rate: toRate(entry.edited, entry.imported),
        review_rate: toRate(entry.reviewed, entry.imported),
      top_changed_fields: changedFieldCounts,
      item_reliability: summarizeItemReliability(rows.filter((row) => extractSenderDomain(row.from_address) === entry.sender_domain)),
    };
    })
    .sort((a, b) =>
      b.imported - a.imported
      || b.dismissal_rate - a.dismissal_rate
      || a.sender_domain.localeCompare(b.sender_domain))
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
}

function classifySenderMetrics(metrics) {
  if (metrics.imported < 3) return 'unknown';
  if (metrics.clean_approval_rate >= 0.6 && metrics.dismissal_rate <= 0.15 && metrics.edit_rate <= 0.35) return 'trusted';
  if (metrics.dismissal_rate >= 0.4 || metrics.edit_rate >= 0.6) return 'noisy';
  return 'mixed';
}

function buildQualityDebug(rows, senderLimit = 5) {
  const senderQuality = buildSenderSummary(rows, Math.max(senderLimit, 10));
  const sender_level_counts = senderQuality.reduce((acc, sender) => {
    const level = classifySenderMetrics(sender);
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, { trusted: 0, mixed: 0, noisy: 0, unknown: 0 });

  const top_corrected_senders = senderQuality
    .filter((sender) => sender.edited > 0 || sender.dismissed > 0)
    .map((sender) => ({
      sender_domain: sender.sender_domain,
      level: classifySenderMetrics(sender),
      edited: sender.edited,
      dismissed: sender.dismissed,
      top_changed_fields: sender.top_changed_fields,
    }))
    .slice(0, Math.max(1, Math.min(Number(senderLimit) || 5, 20)));

  const fieldCounts = new Map();
  for (const row of rows) {
    const changedFields = Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [];
    for (const field of changedFields) {
      fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
    }
  }

  const top_corrected_fields = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([field, count]) => ({ field, count }));

  return {
    sender_level_counts,
    top_corrected_senders,
    top_corrected_fields,
  };
}

async function getGmailImportQualitySummary(userId, days = 30, senderLimit = 5) {
  const [summary, rows] = await Promise.all([
    EmailImportLog.summarizeByUser(userId, days),
    EmailImportLog.listQualitySignalsByUser(userId, days),
  ]);

  const imported = Number(summary.imported || 0);
  const cleanApproved = Number(summary.approved_without_changes || 0);
  const approvedAfterChanges = Number(summary.approved_after_changes || 0);
  const dismissed = Number(summary.reviewed_dismissed || 0);
  const edited = Number(summary.reviewed_edited || 0);
  const reviewedTotal = rows.filter((row) => row.review_action || Number(row.review_edit_count || 0) > 0).length;

  return {
    ...summary,
    quality: {
      total_reviewed: reviewedTotal,
      clean_approved: cleanApproved,
      approved_after_changes: approvedAfterChanges,
      dismissed,
      edited,
      clean_import_rate: toRate(cleanApproved, imported),
      review_rate: toRate(reviewedTotal, imported),
      dismissal_rate: toRate(dismissed, imported),
      edit_rate: toRate(edited, imported),
      sender_quality: buildSenderSummary(rows, senderLimit),
    },
    debug: buildQualityDebug(rows, senderLimit),
  };
}

async function getSenderImportQuality(userId, fromAddress, days = 90) {
  const senderDomain = extractSenderDomain(fromAddress);
  const rows = await EmailImportLog.listQualitySignalsByUser(userId, days);
  const senderRows = rows.filter((row) => extractSenderDomain(row.from_address) === senderDomain);
  const reviewedSenderRows = senderRows.filter((row) => row.review_action || Number(row.review_edit_count || 0) > 0);
  const metrics = summarizeSenderRows(reviewedSenderRows);
  const level = classifySenderMetrics(metrics);
  const top_changed_fields = buildSenderSummary(senderRows, 1)[0]?.top_changed_fields || [];
  const item_reliability = summarizeItemReliability(senderRows);

  return {
    sender_domain: senderDomain,
    level,
    metrics,
    top_changed_fields,
    item_reliability,
  };
}

module.exports = {
  getGmailImportQualitySummary,
  extractSenderDomain,
  getSenderImportQuality,
  classifySenderMetrics,
};
