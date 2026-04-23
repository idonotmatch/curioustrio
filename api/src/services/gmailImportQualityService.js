const EmailImportLog = require('../models/emailImportLog');
const GmailSenderPreference = require('../models/gmailSenderPreference');

function extractSenderDomain(fromAddress = '') {
  const match = `${fromAddress || ''}`.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || 'unknown';
}

function extractSubjectPattern(subject = '', fromAddress = '') {
  const senderDomain = extractSenderDomain(fromAddress);
  const trimmed = `${subject || ''}`.trim();
  const normalized = trimmed.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  if (senderDomain === 'amazon.com') {
    if (/^ORDER:\s*/i.test(normalized)) return 'amazon_order';
    if (/\b(refund|return|returned|refund processed)\b/i.test(normalized)) return 'amazon_refund';
    if (/\b(shipped|shipping|arriving|delivered|out for delivery|has shipped|on the way)\b/i.test(normalized)) {
      return 'amazon_shipping';
    }
    if (/\b(deal|promotion|recommended|save on|subscribe & save)\b/i.test(normalized)) {
      return 'amazon_marketing';
    }
  }

  const genericPatterns = [
    ['generic_order', /^order:\s*/i],
    ['generic_receipt', /\b(receipt|your receipt|order receipt|purchase receipt)\b/i],
    ['generic_refund', /\b(refund|return processed|refund processed|returned)\b/i],
    ['generic_shipping', /\b(shipped|shipping update|arriving|delivered|out for delivery|has shipped|on the way|ready for pickup)\b/i],
    ['generic_payment', /\b(payment sent|payment received|receipt for your payment|paid to|you paid)\b/i],
    ['generic_invoice', /\b(invoice|bill available|statement ready)\b/i],
    ['generic_subscription', /\b(subscription|renewal|membership renewal|plan renewal)\b/i],
    ['generic_trip', /\b(trip receipt|ride receipt|your trip|your ride|thanks for riding|stay receipt|booking confirmation|reservation confirmed)\b/i],
    ['generic_marketing', /\b(deal|promotion|recommended|save on|weekly deals|sale|special offer)\b/i],
  ];
  for (const [key, pattern] of genericPatterns) {
    if (pattern.test(normalized)) return key;
  }

  const leadingToken = normalized.match(/^([A-Za-z][A-Za-z0-9 '&/-]{1,30}:)/);
  if (leadingToken) return leadingToken[1].toLowerCase();

  const tokenized = lower
    .replace(/\b\d{1,4}[/-]\d{1,4}([/-]\d{2,4})?\b/g, ' * ')
    .replace(/\b\d+\b/g, ' * ')
    .replace(/\b[a-f0-9]{8,}\b/gi, ' * ')
    .replace(/\b(order|invoice|receipt|payment|refund|return|trip|booking|reservation)\s+#?[a-z0-9-]+\b/gi, '$1 *')
    .replace(/\s+/g, ' ')
    .trim();

  return tokenized.slice(0, 64) || 'unknown_subject';
}

function toRate(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function isItemField(field = '') {
  return `${field}`.startsWith('items');
}

function isReviewPathField(field = '') {
  return `${field}`.startsWith('review_path_');
}

function isDismissReasonField(field = '') {
  return `${field}`.startsWith('dismiss_reason_');
}

function extractReviewPath(changedFields = []) {
  const fields = Array.isArray(changedFields) ? changedFields : [];
  const match = fields.find(isReviewPathField);
  return match ? `${match}`.replace(/^review_path_/, '') : null;
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

function summarizeReviewPathReliability(reviewPaths = [], metrics = {}) {
  const counts = new Map((Array.isArray(reviewPaths) ? reviewPaths : []).map((entry) => [entry.path, Number(entry.count || 0)]));
  const quickCheckCount = counts.get('quick_check') || 0;
  const fullReviewCount = counts.get('full_review') || 0;
  const itemsFirstCount = counts.get('items_first') || 0;
  const total = quickCheckCount + fullReviewCount + itemsFirstCount;
  const quickCheckRate = toRate(quickCheckCount, total);

  const fastLaneEligible = (
    Number(metrics.imported || 0) >= 3
    && (metrics.clean_approval_rate || 0) >= 0.6
    && (metrics.dismissal_rate || 0) <= 0.15
    && (metrics.needed_more_review_rate || 0) <= 0.15
    && (metrics.level || 'unknown') === 'trusted'
    && quickCheckCount >= 2
    && quickCheckRate >= 0.5
    && fullReviewCount <= 1
  );

  return {
    quick_check_count: quickCheckCount,
    items_first_count: itemsFirstCount,
    full_review_count: fullReviewCount,
    quick_check_rate: quickCheckRate,
    fast_lane_eligible: fastLaneEligible,
  };
}

function summarizeSenderFeedback(feedbackRows = []) {
  let shouldHaveImported = 0;
  let didntNeedReview = 0;
  let neededMoreReview = 0;

  for (const row of feedbackRows) {
    if (row.user_feedback === 'should_have_imported') shouldHaveImported += 1;
    if (row.user_feedback === 'didnt_need_review') didntNeedReview += 1;
    if (row.user_feedback === 'needed_more_review') neededMoreReview += 1;
  }

  return {
    should_have_imported: shouldHaveImported,
    didnt_need_review: didntNeedReview,
    needed_more_review: neededMoreReview,
  };
}

function frequentDismissReason(senderQuality = {}) {
  const topReasons = Array.isArray(senderQuality?.top_dismiss_reasons)
    ? senderQuality.top_dismiss_reasons
    : [];
  return topReasons.find((entry) => Number(entry?.count || 0) >= 2)?.reason || null;
}

function summarizeTemplateRows(rows = [], fromAddress = '', subject = '') {
  const senderDomain = extractSenderDomain(fromAddress);
  const subjectPattern = extractSubjectPattern(subject, fromAddress);
  const templateRows = rows.filter((row) =>
    extractSenderDomain(row.from_address) === senderDomain
    && extractSubjectPattern(row.subject, row.from_address) === subjectPattern
  );

  const imported = templateRows.length;
  let cleanApproved = 0;
  let dismissed = 0;
  let edited = 0;
  let structuredItemBlockCount = 0;
  let structuredItemBlockStrongCount = 0;
  let deterministicItemCountTotal = 0;

  for (const row of templateRows) {
    const editCount = Number(row.review_edit_count || 0);
    if (row.review_action === 'approved' && editCount === 0) cleanApproved += 1;
    if (row.review_action === 'dismissed') dismissed += 1;
    if (editCount > 0) edited += 1;
    const itemBlockLevel = `${row.structured_item_block_level || ''}`.trim().toLowerCase();
    if (itemBlockLevel && itemBlockLevel !== 'none') structuredItemBlockCount += 1;
    if (itemBlockLevel === 'strong') structuredItemBlockStrongCount += 1;
    deterministicItemCountTotal += Math.max(0, Number(row.deterministic_item_count || 0));
  }

  const learnedDisposition = inferTemplateDisposition(subjectPattern, imported, cleanApproved, dismissed);

  return {
    subject_pattern: subjectPattern,
    imported,
    clean_approved: cleanApproved,
    dismissed,
    edited,
    clean_approval_rate: toRate(cleanApproved, imported),
    dismissal_rate: toRate(dismissed, imported),
    edit_rate: toRate(edited, imported),
    structured_item_block_count: structuredItemBlockCount,
    structured_item_block_strong_count: structuredItemBlockStrongCount,
    structured_item_block_rate: toRate(structuredItemBlockCount, imported),
    structured_item_block_strong_rate: toRate(structuredItemBlockStrongCount, imported),
    average_deterministic_item_count: imported ? Number((deterministicItemCountTotal / imported).toFixed(2)) : 0,
    learned_disposition: learnedDisposition,
    force_import_review: learnedDisposition === 'transactional',
    should_skip_prequeue: learnedDisposition === 'non_transactional',
  };
}

function inferTemplateDisposition(subjectPattern = '', imported = 0, cleanApproved = 0, dismissed = 0) {
  const baseline = {
    amazon_order: 'transactional',
    amazon_refund: 'transactional',
    amazon_shipping: 'non_transactional',
    amazon_marketing: 'non_transactional',
    generic_order: 'transactional',
    generic_receipt: 'transactional',
    generic_refund: 'transactional',
    generic_shipping: 'non_transactional',
    generic_payment: 'transactional',
    generic_invoice: 'transactional',
    generic_subscription: 'transactional',
    generic_trip: 'transactional',
    generic_marketing: 'non_transactional',
  }[subjectPattern] || 'unknown';

  let learnedDisposition = baseline;
  if (imported >= 2) {
    const dismissalRate = toRate(dismissed, imported);
    const cleanApprovalRate = toRate(cleanApproved, imported);
    if (dismissalRate >= 0.5) learnedDisposition = 'non_transactional';
    else if (cleanApprovalRate >= 0.5) learnedDisposition = 'transactional';
  }
  return learnedDisposition;
}

function buildTemplateSummary(rows = [], limit = 8) {
  const grouped = new Map();

  for (const row of rows) {
    const senderDomain = extractSenderDomain(row.from_address);
    const subjectPattern = extractSubjectPattern(row.subject, row.from_address);
    const key = `${senderDomain}::${subjectPattern}`;
    const current = grouped.get(key) || {
      sender_domain: senderDomain,
      subject_pattern: subjectPattern,
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      approved: 0,
      dismissed: 0,
      edited: 0,
      structured_item_block_count: 0,
      structured_item_block_strong_count: 0,
      deterministic_item_count_total: 0,
      top_skip_reasons: new Map(),
    };

    current.total += 1;
    if (row.status === 'imported') current.imported += 1;
    if (row.status === 'skipped') current.skipped += 1;
    if (row.status === 'failed') current.failed += 1;
    if (row.review_action === 'approved') current.approved += 1;
    if (row.review_action === 'dismissed') current.dismissed += 1;
    if (Number(row.review_edit_count || 0) > 0) current.edited += 1;
    const itemBlockLevel = `${row.structured_item_block_level || ''}`.trim().toLowerCase();
    if (itemBlockLevel && itemBlockLevel !== 'none') current.structured_item_block_count += 1;
    if (itemBlockLevel === 'strong') current.structured_item_block_strong_count += 1;
    current.deterministic_item_count_total += Math.max(0, Number(row.deterministic_item_count || 0));
    if (row.status === 'skipped' && row.skip_reason) {
      current.top_skip_reasons.set(row.skip_reason, (current.top_skip_reasons.get(row.skip_reason) || 0) + 1);
    }
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => ({
      sender_domain: entry.sender_domain,
      subject_pattern: entry.subject_pattern,
      total: entry.total,
      imported: entry.imported,
      skipped: entry.skipped,
      failed: entry.failed,
      approved: entry.approved,
      dismissed: entry.dismissed,
      edited: entry.edited,
      structured_item_block_count: entry.structured_item_block_count,
      structured_item_block_strong_count: entry.structured_item_block_strong_count,
      structured_item_block_rate: toRate(entry.structured_item_block_count, entry.imported),
      structured_item_block_strong_rate: toRate(entry.structured_item_block_strong_count, entry.imported),
      average_deterministic_item_count: entry.imported
        ? Number((entry.deterministic_item_count_total / entry.imported).toFixed(2))
        : 0,
      learned_disposition: inferTemplateDisposition(entry.subject_pattern, entry.imported, entry.approved, entry.dismissed),
      top_skip_reasons: [...entry.top_skip_reasons.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([reason, count]) => ({ reason, count })),
    }))
    .sort((a, b) =>
      b.total - a.total
      || b.skipped - a.skipped
      || a.subject_pattern.localeCompare(b.subject_pattern))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)));
}

function recommendReviewMode(senderQuality = {}) {
  if (senderQuality?.sender_preference?.force_review) {
    return 'full_review';
  }
  const senderLevel = senderQuality?.level || 'unknown';
  const itemLevel = senderQuality?.item_reliability?.level || 'unknown';
  const fastLaneEligible = !!senderQuality?.review_path_reliability?.fast_lane_eligible;
  const dominantDismissReason = frequentDismissReason(senderQuality);
  const structuredTemplateStrength = Number(senderQuality?.template_quality?.structured_item_block_strong_rate || 0);
  const structuredTemplateCount = Number(senderQuality?.template_quality?.structured_item_block_strong_count || 0);

  if ([
    'not_an_expense',
    'duplicate',
    'transfer_or_payment',
    'business_or_track_only',
    'wrong_details',
  ].includes(dominantDismissReason)) {
    return 'full_review';
  }

  if (senderLevel === 'trusted' && (itemLevel === 'trusted' || fastLaneEligible)) {
    return 'quick_check';
  }

  if (senderLevel !== 'noisy' && structuredTemplateCount >= 2 && structuredTemplateStrength >= 0.5) {
    return 'items_first';
  }

  if (
    (senderLevel === 'trusted' && (itemLevel === 'mixed' || itemLevel === 'noisy'))
    || (senderLevel === 'mixed' && itemLevel === 'noisy')
  ) {
    return 'items_first';
  }

  return 'full_review';
}

function summarizeSenderRows(rows = [], feedbackSummary = {}) {
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

  const shouldHaveImported = Number(feedbackSummary.should_have_imported || 0);
  const didntNeedReview = Number(feedbackSummary.didnt_need_review || 0);
  const neededMoreReview = Number(feedbackSummary.needed_more_review || 0);

  return {
    imported,
    reviewed,
    clean_approved: cleanApproved,
    approved_after_changes: approvedAfterChanges,
    dismissed,
    edited,
    should_have_imported: shouldHaveImported,
    didnt_need_review: didntNeedReview,
    needed_more_review: neededMoreReview,
    clean_approval_rate: toRate(cleanApproved, imported),
    dismissal_rate: toRate(dismissed, imported),
    edit_rate: toRate(edited, imported),
    review_rate: toRate(reviewed, imported),
    should_have_imported_rate: toRate(shouldHaveImported, imported),
    didnt_need_review_rate: toRate(didntNeedReview, imported),
    needed_more_review_rate: toRate(neededMoreReview, imported),
  };
}

function buildSenderSummary(rows, limit = 5) {
  const feedbackBySender = arguments[2] || new Map();
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
      should_have_imported: 0,
      didnt_need_review: 0,
      needed_more_review: 0,
      top_changed_fields: [],
    };

    current.imported += 1;
    const editCount = Number(row.review_edit_count || 0);
    const changedFields = Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [];
    const reviewPath = extractReviewPath(changedFields);
    const hasReview = !!row.review_action || editCount > 0;
    if (hasReview) current.reviewed += 1;
    if (row.review_action === 'dismissed') current.dismissed += 1;
    if (row.review_action === 'approved' && editCount === 0) current.clean_approved += 1;
    if (row.review_action === 'approved' && editCount > 0) current.approved_after_changes += 1;
    if (editCount > 0) {
      current.edited += 1;
      current._changedFieldCounts = current._changedFieldCounts || new Map();
      current._dismissReasonCounts = current._dismissReasonCounts || new Map();
      for (const field of changedFields.filter((field) => !isReviewPathField(field))) {
        if (isDismissReasonField(field)) {
          current._dismissReasonCounts.set(field, (current._dismissReasonCounts.get(field) || 0) + 1);
          continue;
        }
        current._changedFieldCounts.set(field, (current._changedFieldCounts.get(field) || 0) + 1);
      }
    }
    if (row.review_action === 'dismissed') {
      current._dismissReasonCounts = current._dismissReasonCounts || new Map();
      for (const field of changedFields.filter(isDismissReasonField)) {
        current._dismissReasonCounts.set(field, (current._dismissReasonCounts.get(field) || 0) + 1);
      }
    }
    if (row.user_feedback === 'should_have_imported') current.should_have_imported += 1;
    if (row.user_feedback === 'didnt_need_review') current.didnt_need_review += 1;
    if (row.user_feedback === 'needed_more_review') current.needed_more_review += 1;
    if (reviewPath) {
      current._reviewPathCounts = current._reviewPathCounts || new Map();
      current._reviewPathCounts.set(reviewPath, (current._reviewPathCounts.get(reviewPath) || 0) + 1);
    }

    grouped.set(senderDomain, current);
  }

  return [...grouped.values()]
    .map((entry) => {
      const changedFieldCounts = [...(entry._changedFieldCounts || new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([field, count]) => ({ field, count }));
      const review_paths = [...(entry._reviewPathCounts || new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([path, count]) => ({ path, count }));
      const top_dismiss_reasons = [...(entry._dismissReasonCounts || new Map()).entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([reason, count]) => ({ reason: `${reason}`.replace(/^dismiss_reason_/, ''), count }));
      const feedbackSummary = feedbackBySender.get(entry.sender_domain) || {};
      const metrics = {
        imported: entry.imported,
        clean_approval_rate: toRate(entry.clean_approved, entry.imported),
        dismissal_rate: toRate(entry.dismissed, entry.imported),
        needed_more_review_rate: toRate(feedbackSummary.needed_more_review || 0, entry.imported),
      };
      metrics.level = classifySenderMetrics({
        imported: entry.imported,
        clean_approval_rate: metrics.clean_approval_rate,
        dismissal_rate: metrics.dismissal_rate,
        edit_rate: toRate(entry.edited, entry.imported),
        needed_more_review_rate: metrics.needed_more_review_rate,
      });
      const review_path_reliability = summarizeReviewPathReliability(review_paths, metrics);
      delete entry._changedFieldCounts;
      delete entry._reviewPathCounts;
      delete entry._dismissReasonCounts;
      return {
        ...entry,
        clean_approval_rate: metrics.clean_approval_rate,
        dismissal_rate: metrics.dismissal_rate,
        edit_rate: toRate(entry.edited, entry.imported),
        review_rate: toRate(entry.reviewed, entry.imported),
        should_have_imported: Number(feedbackSummary.should_have_imported || 0),
        didnt_need_review: Number(feedbackSummary.didnt_need_review || 0),
        needed_more_review: Number(feedbackSummary.needed_more_review || 0),
        should_have_imported_rate: toRate(feedbackSummary.should_have_imported || 0, entry.imported),
        didnt_need_review_rate: toRate(feedbackSummary.didnt_need_review || 0, entry.imported),
        needed_more_review_rate: toRate(feedbackSummary.needed_more_review || 0, entry.imported),
        top_changed_fields: changedFieldCounts,
        top_dismiss_reasons,
        review_paths,
        review_path_reliability,
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
  if ((metrics.needed_more_review_rate || 0) >= 0.3) return 'noisy';
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
    const changedFields = (Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [])
      .filter((field) => !isReviewPathField(field) && !isDismissReasonField(field));
    for (const field of changedFields) {
      fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
    }
  }

  const top_corrected_fields = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([field, count]) => ({ field, count }));

  const dismissReasonCounts = new Map();
  for (const row of rows) {
    const changedFields = (Array.isArray(row.review_changed_fields) ? row.review_changed_fields : [])
      .filter(isDismissReasonField);
    for (const field of changedFields) {
      dismissReasonCounts.set(field, (dismissReasonCounts.get(field) || 0) + 1);
    }
  }

  const top_dismiss_reasons = [...dismissReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([reason, count]) => ({ reason: `${reason}`.replace(/^dismiss_reason_/, ''), count }));

  return {
    sender_level_counts,
    top_corrected_senders,
    top_corrected_fields,
    top_dismiss_reasons,
  };
}

async function getGmailImportQualitySummary(userId, days = 30, senderLimit = 5) {
  const [summary, rows, feedbackRows, templateRows] = await Promise.all([
    EmailImportLog.summarizeByUser(userId, days),
    EmailImportLog.listQualitySignalsByUser(userId, days),
    EmailImportLog.listDecisionFeedbackByUser(userId, days),
    EmailImportLog.listTemplateSignalsByUser(userId, days),
  ]);
  const senderPreferences = await GmailSenderPreference.listByUser(userId);
  const preferenceMap = new Map(senderPreferences.map((pref) => [pref.sender_domain, pref]));
  const feedbackBySender = new Map();
  for (const row of feedbackRows) {
    const senderDomain = extractSenderDomain(row.from_address);
    const current = feedbackBySender.get(senderDomain) || { should_have_imported: 0, didnt_need_review: 0, needed_more_review: 0 };
    if (row.user_feedback === 'should_have_imported') current.should_have_imported += 1;
    if (row.user_feedback === 'didnt_need_review') current.didnt_need_review += 1;
    if (row.user_feedback === 'needed_more_review') current.needed_more_review += 1;
    feedbackBySender.set(senderDomain, current);
  }
  const senderQuality = buildSenderSummary(rows, senderLimit, feedbackBySender).map((sender) => ({
    ...sender,
    sender_preference: {
      force_review: !!preferenceMap.get(sender.sender_domain)?.force_review,
    },
  }));

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
      sender_quality: senderQuality,
    },
    debug: {
      ...buildQualityDebug(rows, senderLimit),
      top_templates: buildTemplateSummary(templateRows, 8),
    },
    sender_preferences: senderPreferences,
  };
}

async function getSenderImportQuality(userId, fromAddress, days = 90) {
  let subject = '';
  let safeDays = days;
  if (typeof days === 'string' && arguments.length >= 3) {
    subject = days;
    safeDays = arguments[3] || 90;
  } else if (typeof arguments[2] === 'string') {
    subject = arguments[2];
    safeDays = arguments[3] || 90;
  }
  const senderDomain = extractSenderDomain(fromAddress);
  const senderPreference = await GmailSenderPreference.findByUserAndDomain(userId, senderDomain);
  const [rows, feedbackRows] = await Promise.all([
    EmailImportLog.listQualitySignalsByUser(userId, safeDays),
    EmailImportLog.listDecisionFeedbackByUser(userId, safeDays),
  ]);
  const senderRows = rows.filter((row) => extractSenderDomain(row.from_address) === senderDomain);
  const senderFeedbackSummary = summarizeSenderFeedback(
    feedbackRows.filter((row) => extractSenderDomain(row.from_address) === senderDomain)
  );
  const reviewedSenderRows = senderRows.filter((row) => row.review_action || Number(row.review_edit_count || 0) > 0);
  const metrics = summarizeSenderRows(reviewedSenderRows, senderFeedbackSummary);
  const level = classifySenderMetrics(metrics);
  metrics.level = level;
  const senderSummary = buildSenderSummary(senderRows, 1, new Map([[senderDomain, senderFeedbackSummary]]))[0] || {};
  const top_changed_fields = senderSummary.top_changed_fields || [];
  const review_paths = senderSummary.review_paths || [];
  const review_path_reliability = senderSummary.review_path_reliability || summarizeReviewPathReliability([], metrics);
  const item_reliability = summarizeItemReliability(senderRows);
  const template_quality = summarizeTemplateRows(rows, fromAddress, subject);

  return {
    sender_domain: senderDomain,
    level,
    metrics,
    top_changed_fields,
    review_paths,
    review_path_reliability,
    item_reliability,
    template_quality,
    sender_preference: senderPreference
      ? { force_review: !!senderPreference.force_review }
      : { force_review: false },
  };
}

module.exports = {
  getGmailImportQualitySummary,
  extractSenderDomain,
  extractSubjectPattern,
  getSenderImportQuality,
  classifySenderMetrics,
  frequentDismissReason,
  recommendReviewMode,
};
