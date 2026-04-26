const { recommendReviewMode } = require('./gmailImportQualityService');

function deriveEmailFieldEvidence(expense, log) {
  if (!expense || !log?.message_id) return {};

  const subject = `${log.subject || ''}`;
  const fromAddress = `${log.from_address || ''}`;
  const merchant = `${expense.merchant || ''}`.trim();
  const amount = Math.abs(Number(expense.amount || 0));
  const importedDate = log.imported_at ? new Date(log.imported_at).toISOString().slice(0, 10) : null;

  let merchantEvidence = null;
  if (merchant) {
    const merchantPattern = merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(merchantPattern, 'i').test(subject)) {
      merchantEvidence = 'Merchant matched from the email subject.';
    } else if (fromAddress.toLowerCase().includes(merchant.toLowerCase().replace(/\s+/g, ''))) {
      merchantEvidence = 'Merchant matched from the sender address.';
    } else if (fromAddress) {
      merchantEvidence = 'Merchant was inferred from the sender and email context.';
    }
  }

  let amountEvidence = null;
  if (amount > 0) {
    const amountPattern = amount.toFixed(2).replace('.', '\\.');
    const text = `${subject} ${expense.notes || ''}`;
    if (new RegExp(`\\$\\s?${amountPattern}\\b`).test(text)) {
      amountEvidence = 'Amount matched a total called out in the email.';
    } else if (Array.isArray(expense.items) && expense.items.length > 0) {
      amountEvidence = `Amount was checked against ${expense.items.length} extracted ${expense.items.length === 1 ? 'line item' : 'line items'}.`;
    } else {
      amountEvidence = 'Amount was extracted from the email purchase summary.';
    }
  }

  let dateEvidence = null;
  if (expense.date && importedDate && expense.date.slice(0, 10) === importedDate) {
    dateEvidence = 'Date is based on when the email was received.';
  } else if (expense.date) {
    dateEvidence = 'Date was extracted from the email timing details.';
  }

  return {
    merchant_evidence: merchantEvidence,
    amount_evidence: amountEvidence,
    date_evidence: dateEvidence,
  };
}

function buildEmailReviewRouting(senderQuality, itemReliability, preferredReviewMode = null) {
  const reviewMode = preferredReviewMode || recommendReviewMode({ ...senderQuality, item_reliability: itemReliability });

  if (reviewMode === 'quick_check') {
    return {
      review_mode: 'quick_check',
      review_title: 'Quick check before approving',
      review_message: senderQuality?.review_path_reliability?.fast_lane_eligible
        ? 'You usually quick-approve imports from this sender, so a fast confirmation is probably enough here.'
        : 'This sender is usually accurate, so a fast confirmation is probably enough here.',
      review_checklist: [
        'Amount: confirm this is the final charged total.',
        'Merchant and date: make sure they look right at a glance.',
      ],
    };
  }

  if (reviewMode === 'items_first') {
    const itemLevel = itemReliability?.level || 'unknown';
    const trustedItems = itemLevel === 'trusted';
    const noisyItems = itemLevel === 'noisy';
    return {
      review_mode: 'items_first',
      review_title: trustedItems ? 'Items found from this receipt' : 'Focus on the items before approving',
      review_message: trustedItems
        ? 'Line items from this sender are usually usable, so confirm the basket and final total.'
        : noisyItems
          ? 'Line items from this sender often need cleanup before they are useful.'
          : 'The email has item rows worth checking before approval.',
      review_checklist: trustedItems
        ? [
            'Items: scan the product list for anything obviously missing or extra.',
            'Amount: confirm the final total still matches what was charged.',
          ]
        : [
            'Items: remove fee, discount, or total rows that should not count as purchases.',
            'Items: make sure the product names and per-item amounts look right.',
            'Amount: confirm the final total still matches what was actually charged.',
          ],
    };
  }

  return {
    review_mode: 'full_review',
    review_title: 'Review this import before approving',
    review_message: 'Use the email context below to confirm the merchant, amount, and date before approving.',
    review_checklist: [
      'Merchant: does the sender and subject match the place you expect?',
      'Amount: does the total reflect the actual charge, not a subtotal or preauth?',
      'Date: is this the purchase day you want to track for the expense?',
    ],
  };
}

function buildEmailReviewHint(expense, log, senderQuality) {
  if (!log?.message_id) return null;

  const level = senderQuality?.level || 'unknown';
  const likelyChangedFields = Array.isArray(senderQuality?.top_changed_fields)
    ? senderQuality.top_changed_fields.map((entry) => entry.field).filter(Boolean)
    : [];
  const itemReliability = senderQuality?.item_reliability || null;
  const automationRecommendation = senderQuality?.automation_recommendation || null;
  const fieldEvidence = deriveEmailFieldEvidence(expense, log);
  const reviewRouting = buildEmailReviewRouting(senderQuality, itemReliability, expense.review_mode || null);

  let headline = 'Imported from Gmail';
  let tone = 'info';
  let message = 'Review the details before approving this import.';

  if (log.review_action === 'approved') {
    return {
      sender_domain: senderQuality?.sender_domain || null,
      from_address: log.from_address || null,
      imported_at: log.imported_at || null,
      sender_quality_level: level,
      sender_quality_metrics: senderQuality?.metrics || null,
      likely_changed_fields: likelyChangedFields,
      item_reliability_level: itemReliability?.level || 'unknown',
      item_reliability_message: itemReliability?.message || null,
      item_top_signals: itemReliability?.top_signals || [],
      automation_recommendation: automationRecommendation,
      review_mode: reviewRouting.review_mode,
      review_title: reviewRouting.review_title,
      review_message: reviewRouting.review_message,
      review_checklist: reviewRouting.review_checklist,
      message_subject: log.subject || null,
      message_snippet: log.snippet || null,
      ...fieldEvidence,
      headline: 'Reviewed Gmail import',
      tone: 'positive',
      message: log.review_edit_count > 0
        ? 'This Gmail import was reviewed and updated before it was confirmed.'
        : 'This Gmail import was reviewed before it was confirmed.',
    };
  }

  if (level === 'trusted') {
    tone = 'positive';
    headline = 'Trusted sender';
    message = 'This sender is usually accurate. A quick check is probably enough.';
  } else if (level === 'noisy') {
    tone = 'warning';
    headline = 'Low-confidence sender';
    message = 'Imports from this sender often need edits or get dismissed, so review carefully.';
  } else if (level === 'mixed') {
    tone = 'caution';
    headline = 'Mixed sender history';
    message = 'Imports from this sender are sometimes right and sometimes need correction.';
  }

  return {
    sender_domain: senderQuality?.sender_domain || null,
    from_address: log.from_address || null,
    imported_at: log.imported_at || null,
    sender_quality_level: level,
    sender_quality_metrics: senderQuality?.metrics || null,
    likely_changed_fields: likelyChangedFields,
    item_reliability_level: itemReliability?.level || 'unknown',
    item_reliability_message: itemReliability?.message || null,
    item_top_signals: itemReliability?.top_signals || [],
    automation_recommendation: automationRecommendation,
    review_mode: reviewRouting.review_mode,
    review_title: reviewRouting.review_title,
    review_message: reviewRouting.review_message,
    review_checklist: reviewRouting.review_checklist,
    message_subject: log.subject || null,
    message_snippet: log.snippet || null,
    ...fieldEvidence,
    headline,
    tone,
    message,
  };
}

module.exports = {
  buildEmailReviewHint,
};
