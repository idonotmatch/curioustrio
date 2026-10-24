const { recommendReviewMode } = require('./gmailImportQualityService');

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

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
  const expenseDate = dateOnly(expense.date);
  if (expenseDate && importedDate && expenseDate === importedDate) {
    dateEvidence = 'Date is based on when the email was received.';
  } else if (expenseDate) {
    dateEvidence = 'Date was extracted from the email timing details.';
  }

  return {
    merchant_evidence: merchantEvidence,
    amount_evidence: amountEvidence,
    date_evidence: dateEvidence,
  };
}

function buildEmailFieldEvidence(expense, log, senderQuality = {}) {
  const legacy = deriveEmailFieldEvidence(expense, log);
  const subject = `${log?.subject || ''}`;
  const fromAddress = `${log?.from_address || ''}`;
  const merchant = `${expense?.merchant || ''}`.trim();
  const amount = Math.abs(Number(expense?.amount || 0));
  const amountPattern = Number.isFinite(amount) && amount > 0
    ? amount.toFixed(2).replace('.', '\\.')
    : null;
  const amountText = `${subject} ${expense?.notes || ''}`;
  const merchantInSubject = merchant
    ? new RegExp(merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(subject)
    : false;
  const merchantFromSender = merchant
    ? fromAddress.toLowerCase().includes(merchant.toLowerCase().replace(/\s+/g, ''))
    : false;
  const amountExplicit = amountPattern ? new RegExp(`(?:\\$|USD\\s*)?${amountPattern}\\b`, 'i').test(amountText) : false;
  const hasItems = Array.isArray(expense?.items) && expense.items.length > 0;
  const importedDate = dateOnly(log?.imported_at);
  const expenseDate = dateOnly(expense?.date);
  const itemLevel = senderQuality?.item_reliability?.level || 'unknown';

  const fieldEvidence = {
    merchant: {
      confidence: merchantInSubject ? 'high' : (merchantFromSender || fromAddress ? 'medium' : 'low'),
      questionable: !merchantInSubject && !merchantFromSender,
      detail: legacy.merchant_evidence || 'Merchant could not be tied to a strong email signal.',
      source: merchantInSubject ? 'subject' : 'sender',
    },
    amount: {
      confidence: amountExplicit ? 'high' : (hasItems ? 'medium' : 'low'),
      questionable: !amountExplicit && !hasItems,
      detail: legacy.amount_evidence || 'The final charged total was not explicit in the email summary.',
      source: amountExplicit ? 'email_total' : (hasItems ? 'line_items' : 'extraction'),
    },
    date: {
      confidence: expenseDate && importedDate && expenseDate !== importedDate ? 'high' : 'medium',
      questionable: !expenseDate,
      detail: legacy.date_evidence || 'Confirm the purchase date.',
      source: expenseDate && importedDate && expenseDate !== importedDate ? 'email_date' : 'received_date',
    },
  };

  if (hasItems) {
    fieldEvidence.items = {
      confidence: itemLevel === 'trusted' ? 'high' : (itemLevel === 'noisy' ? 'low' : 'medium'),
      questionable: itemLevel === 'noisy',
      detail: senderQuality?.item_reliability?.message || 'Line items were extracted from the email receipt.',
      source: 'email_items',
    };
  }

  return {
    field_confidence: Object.fromEntries(Object.entries(fieldEvidence).map(([field, value]) => [field, value.confidence])),
    field_evidence: fieldEvidence,
    questionable_fields: Object.entries(fieldEvidence)
      .filter(([, value]) => value.questionable)
      .map(([field]) => field),
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
  const structuredEvidence = expense?.field_evidence && Object.keys(expense.field_evidence).length
    ? {
      field_confidence: expense.field_confidence || {},
      field_evidence: expense.field_evidence,
      questionable_fields: Object.entries(expense.field_evidence)
        .filter(([, value]) => value?.questionable === true)
        .map(([field]) => field),
    }
    : buildEmailFieldEvidence(expense, log, senderQuality);
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
      email_event_type: log.email_event_type || null,
      external_order_id: log.external_order_id || null,
      external_transaction_id: log.external_transaction_id || null,
      related_expense_id: log.related_expense_id || null,
      attachment_count: Number(log.attachment_count || 0),
      attachment_text_count: Number(log.attachment_text_count || 0),
      ...fieldEvidence,
      ...structuredEvidence,
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
    email_event_type: log.email_event_type || null,
    external_order_id: log.external_order_id || null,
    external_transaction_id: log.external_transaction_id || null,
    related_expense_id: log.related_expense_id || null,
    attachment_count: Number(log.attachment_count || 0),
    attachment_text_count: Number(log.attachment_text_count || 0),
    ...fieldEvidence,
    ...structuredEvidence,
    headline,
    tone,
    message,
  };
}

module.exports = {
  buildEmailFieldEvidence,
  buildEmailReviewHint,
  dateOnly,
};
