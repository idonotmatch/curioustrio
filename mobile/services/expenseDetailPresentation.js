function formatImportedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatEmailSnippet(value) {
  const cleaned = `${value || ''}`.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return `$${Number(value).toFixed(2)}`;
}

function formatShortDate(value) {
  if (!value) return null;
  const date = new Date(`${`${value}`.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function labelLikelyField(field = '') {
  switch (`${field}`) {
    case 'amount': return 'amount';
    case 'date': return 'date';
    case 'merchant': return 'merchant';
    case 'category_id': return 'category';
    case 'items': return 'items';
    default: return `${field}`.replace(/^items_/, '').replace(/_/g, ' ');
  }
}

function buildReviewFocusSummary(gmailReviewHint = {}) {
  const likelyFields = Array.isArray(gmailReviewHint?.likely_changed_fields)
    ? gmailReviewHint.likely_changed_fields.filter(Boolean)
    : [];
  const namedFields = likelyFields.map(labelLikelyField);

  if (gmailReviewHint?.review_mode === 'items_first') {
    return {
      title: 'Most likely to need attention',
      body: namedFields.length
        ? `Start with the items, then confirm ${namedFields.slice(0, 2).join(' and ')}.`
        : 'Start with the items, then confirm the final total.',
    };
  }

  if (namedFields.length >= 2) {
    return {
      title: 'Most likely to need attention',
      body: `Double-check ${namedFields.slice(0, 2).join(' and ')} before approving.`,
    };
  }

  if (namedFields.length === 1) {
    return {
      title: 'Most likely to need attention',
      body: `Double-check the ${namedFields[0]} before approving.`,
    };
  }

  return {
    title: 'Most likely to need attention',
    body: gmailReviewHint?.review_mode === 'quick_check'
      ? 'A quick confirmation of the core facts should be enough here.'
      : 'Confirm the core facts before approving this import.',
  };
}

function buildReviewDecisionFacts({ expense, gmailReviewHint, formattedDate, importedAtLabel, categoryLabel }) {
  const facts = [
    { label: 'Total', value: formatCurrency(Math.abs(Number(expense?.amount || 0))) },
    { label: 'Date', value: formattedDate || null },
    { label: 'Merchant', value: expense?.merchant || null },
    { label: 'Sender', value: gmailReviewHint?.from_address || null },
  ];

  if (!facts.some((entry) => entry.label === 'Date' && entry.value) && importedAtLabel) {
    facts.push({ label: 'Imported', value: importedAtLabel });
  }
  if (categoryLabel && categoryLabel !== 'Uncategorized') {
    facts.push({ label: 'Category', value: categoryLabel });
  }

  return facts.filter((entry) => entry.value).slice(0, 4);
}

function buildTreatmentSuggestionSummary(treatmentSuggestion = null) {
  if (!treatmentSuggestion?.summary) return null;

  const bits = [];
  if (treatmentSuggestion.suggested_track_only) bits.push('track only');
  if (treatmentSuggestion.suggested_private) bits.push('private');
  if (treatmentSuggestion.suggested_category_name) bits.push(treatmentSuggestion.suggested_category_name);

  if (!bits.length) {
    return treatmentSuggestion.summary;
  }

  return `Usually handled as ${bits.join(' · ')}.`;
}

function buildPriorityReviewFields({ expense, gmailReviewHint, formattedDate, categoryLabel }) {
  const likelyFields = Array.isArray(gmailReviewHint?.likely_changed_fields) ? gmailReviewHint.likely_changed_fields : [];
  const likelySet = new Set(likelyFields);
  const isItemsFirst = gmailReviewHint?.review_mode === 'items_first';
  const itemCount = Array.isArray(expense?.items) ? expense.items.length : 0;
  const itemSignals = Array.isArray(gmailReviewHint?.item_top_signals) ? gmailReviewHint.item_top_signals : [];
  const itemSignalSummary = itemSignals.length
    ? itemSignals.map((entry) => `${entry.field}`.replace(/^items_/, '').replace(/_/g, ' ')).join(', ')
    : null;
  const itemHistoryReason = (itemSignalSummary ? `This sender often needs item cleanup around ${itemSignalSummary}.` : null)
    || gmailReviewHint?.item_reliability_message
    || 'This sender often needs item cleanup before approval.';
  const candidates = [
    ...(isItemsFirst ? [{
      key: 'items',
      label: 'Items',
      value: itemCount ? `${itemCount} extracted ${itemCount === 1 ? 'item' : 'items'}` : 'Review extracted items',
      reason: itemHistoryReason,
      weight: 110,
    }] : []),
    {
      key: 'amount',
      label: 'Amount',
      value: `$${Math.abs(Number(expense?.amount || 0)).toFixed(2)}`,
      reason: gmailReviewHint?.amount_evidence || 'Confirm the final charged total.',
      weight: likelySet.has('amount') ? 100 : (isItemsFirst ? 50 : 60),
    },
    {
      key: 'date',
      label: 'Date',
      value: formattedDate,
      reason: gmailReviewHint?.date_evidence || 'Confirm the purchase date you want to track.',
      weight: likelySet.has('date') ? 95 : (isItemsFirst ? 40 : 55),
    },
    {
      key: 'merchant',
      label: 'Merchant',
      value: expense?.merchant || '—',
      reason: gmailReviewHint?.merchant_evidence || 'Confirm the merchant name.',
      weight: likelySet.has('merchant') ? 90 : (isItemsFirst ? 35 : 50),
    },
    {
      key: 'category',
      label: 'Category',
      value: categoryLabel,
      reason: likelySet.has('category_id')
        ? 'This sender often needs a category correction.'
        : 'Check this if the purchase type looks off.',
      weight: likelySet.has('category_id') ? 85 : 35,
    },
  ];

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
}

function formatItemStructuredMeta(item = {}) {
  const bits = [item.brand, item.product_size || item.pack_size].filter(Boolean);
  return bits.length ? bits.join(' • ') : null;
}

function itemMatchLabel(item = {}) {
  if (item.product_id) return 'Matched product';
  if (item.estimated_unit_price != null) return 'Unit priced';
  if (item.comparable_key) return 'Comparable item';
  return null;
}

function itemSubmeta(item = {}) {
  const parts = [];
  if (item.estimated_unit_price != null) {
    parts.push(`${formatCurrency(item.estimated_unit_price)} per ${item.unit || 'unit'}`);
  }
  if (item.product_match_reason) {
    parts.push(`${item.product_match_reason}`.replace(/_/g, ' '));
  }
  return parts.length ? parts.join(' • ') : null;
}

function summarizeItemSignals(items = []) {
  return items.reduce((summary, item) => {
    if (item.product_id) summary.matched += 1;
    if (item.estimated_unit_price != null) summary.unitPriced += 1;
    if (item.item_type && item.item_type !== 'product') summary.nonProduct += 1;
    return summary;
  }, { matched: 0, unitPriced: 0, nonProduct: 0 });
}

module.exports = {
  formatImportedAt,
  formatEmailSnippet,
  formatCurrency,
  formatShortDate,
  buildReviewFocusSummary,
  buildReviewDecisionFacts,
  buildTreatmentSuggestionSummary,
  buildPriorityReviewFields,
  formatItemStructuredMeta,
  itemMatchLabel,
  itemSubmeta,
  summarizeItemSignals,
};
