const EmailImportLog = require('../models/emailImportLog');

function extractSenderDomain(fromAddress = '') {
  const match = `${fromAddress || ''}`.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || 'unknown';
}

function toRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
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
      };
    })
    .sort((a, b) =>
      b.imported - a.imported
      || b.dismissal_rate - a.dismissal_rate
      || a.sender_domain.localeCompare(b.sender_domain))
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)));
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
  };
}

module.exports = { getGmailImportQualitySummary, extractSenderDomain };
