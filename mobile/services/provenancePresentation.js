function sourcePresentation(expense = {}) {
  const source = `${expense?.source || ''}`;
  if (expense?.review_source === 'gmail' || source === 'email') {
    return {
      label: 'Gmail import',
      detail: 'Created from an email receipt and queued for review when confidence is not high enough.',
      tone: 'info',
    };
  }
  if (source === 'camera') {
    return {
      label: 'Receipt scan',
      detail: 'Created from a scanned receipt. Parsed fields may need confirmation.',
      tone: 'accent',
    };
  }
  if (source === 'refund') {
    return {
      label: 'Refund',
      detail: 'Tracked as a refund or credit.',
      tone: 'success',
    };
  }
  return {
    label: 'Manual entry',
    detail: 'Entered by you or someone in the household.',
    tone: 'neutral',
  };
}

function categorySourceLabel(source = '') {
  switch (`${source || ''}`) {
    case 'manual_edit': return 'user edit';
    case 'decision_memory':
    case 'description_memory':
    case 'memory': return 'memory';
    case 'heuristic': return 'rule';
    case 'claude': return 'inference';
    default: return null;
  }
}

function fieldProvenance(expense = {}, gmailReviewHint = {}) {
  const fields = [];
  const categorySource = categorySourceLabel(expense.category_source);
  if (categorySource) fields.push({ label: 'Category', value: categorySource });
  if (gmailReviewHint?.amount_evidence) fields.push({ label: 'Amount', value: 'email evidence' });
  if (gmailReviewHint?.date_evidence) fields.push({ label: 'Date', value: 'email evidence' });
  if (gmailReviewHint?.merchant_evidence) fields.push({ label: 'Merchant', value: 'email sender' });
  if (expense?.place_name || expense?.address) {
    fields.push({
      label: 'Location',
      value: expense?.location_user_owned ? 'user chosen' : (expense?.location_status === 'enriched' ? 'lookup' : 'suggested'),
    });
  }
  return fields.slice(0, 4);
}

function reviewReasonSummary(item = {}) {
  const hint = item?.gmail_review_hint || {};
  if (hint?.automation_recommendation?.reason) return hint.automation_recommendation.reason;
  const likelyFields = Array.isArray(hint?.likely_changed_fields)
    ? hint.likely_changed_fields.filter(Boolean).map((field) => `${field}`.replace('_id', '').replace(/_/g, ' '))
    : [];
  if (hint?.review_mode === 'items_first') return 'Item details need a closer look before this settles into spending.';
  if (likelyFields.length) return `Double-check ${likelyFields.slice(0, 2).join(' and ')} before approving.`;
  if (item?.review_source === 'gmail' || item?.source === 'email') return 'Email import needs a quick confidence check.';
  return 'This expense needs review before it settles.';
}

function locationStatusPresentation(location = {}) {
  const status = `${location?.location_status || location?.status || ''}`;
  if (location?.source === 'current') return { label: 'Added by you', detail: 'Using your current location.' };
  if (location?.source === 'search') return { label: 'Chosen by you', detail: 'Selected from place search.' };
  if (status === 'enriched') return { label: 'Found from receipt', detail: 'Matched from receipt or email location detail.' };
  if (status === 'deferred') return { label: 'Still checking', detail: 'Location lookup will finish in the background.' };
  if (status === 'failed' || status === 'lookup_failed') return { label: 'Lookup failed', detail: 'You can search manually or leave it blank.' };
  if (status === 'permission_denied') return { label: 'Location unavailable', detail: 'Permission is off. You can search manually instead.' };
  if (status === 'no_match') return { label: 'No match found', detail: 'Try a more specific place or address.' };
  return { label: 'Optional', detail: 'Add a place if it helps identify this expense later.' };
}

module.exports = {
  fieldProvenance,
  locationStatusPresentation,
  reviewReasonSummary,
  sourcePresentation,
};
