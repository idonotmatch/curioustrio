const {
  slimSuccessLogsEnabled,
  verboseSuccessSampleRate,
  correctionLearningMode,
} = require('./parsingOptimizationConfig');
const { persistSuccessParsedSnapshotSampleRate } = require('./storageMinimizationConfig');

function estimateJsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
  } catch {
    return null;
  }
}

function buildParsedSnapshot(parsed = {}) {
  return {
    merchant: parsed?.merchant || null,
    description: parsed?.description || null,
    amount: parsed?.amount ?? null,
    date: parsed?.date || null,
    payment_method: parsed?.payment_method || null,
    card_label: parsed?.card_label || null,
    card_last4: parsed?.card_last4 || null,
    currency: parsed?.currency || null,
    subtotal: parsed?.subtotal ?? null,
    tax: parsed?.tax ?? null,
    tip: parsed?.tip ?? null,
    fees: parsed?.fees ?? null,
    discounts: parsed?.discounts ?? null,
    transaction_id_present: Boolean(parsed?.transaction_id),
    store_number_present: Boolean(parsed?.store_number),
    category_id: parsed?.category_id || null,
    category_source: parsed?.category_source || null,
    place_name: parsed?.place_name || null,
    address: parsed?.address || parsed?.store_address || null,
    mapkit_stable_id: parsed?.mapkit_stable_id || null,
    item_count: Array.isArray(parsed?.items) ? parsed.items.length : 0,
    review_fields: Array.isArray(parsed?.review_fields) ? parsed.review_fields : [],
    parse_status: parsed?.parse_status || null,
    receipt_validation: parsed?.receipt_validation ? {
      total_components_match: parsed.receipt_validation.total_components_match ?? null,
      item_sum_matches_subtotal: parsed.receipt_validation.item_sum_matches_subtotal ?? null,
      issues: Array.isArray(parsed.receipt_validation.issues) ? parsed.receipt_validation.issues : [],
      product_item_count: parsed.receipt_validation.product_item_count ?? null,
      unpriced_item_count: parsed.receipt_validation.unpriced_item_count ?? null,
      item_math_mismatch_count: parsed.receipt_validation.item_math_mismatch_count ?? null,
    } : null,
  };
}

function shouldKeepVerboseSuccessMetadata() {
  return Math.random() < verboseSuccessSampleRate();
}

function shouldKeepParsedSnapshotForSuccess() {
  return Math.random() < persistSuccessParsedSnapshotSampleRate();
}

function stripVerboseFields(metadata = {}) {
  const cloned = { ...(metadata || {}) };
  delete cloned.raw_text_preview;
  delete cloned.fallback_raw_text_preview;
  delete cloned.response_length;
  delete cloned.fallback_response_length;
  delete cloned.raw_keys;
  return cloned;
}

function stripRawModelOutput(metadata = {}) {
  const cloned = { ...(metadata || {}) };
  delete cloned.raw_text_preview;
  delete cloned.fallback_raw_text_preview;
  return cloned;
}

function finalizeIngestMetadata({
  status,
  metadata = {},
  parsed = null,
  source = null,
}) {
  const shouldKeepParsedSnapshot = status !== 'parsed' || shouldKeepParsedSnapshotForSuccess();
  const baseMetadata = {
    ...stripRawModelOutput(metadata),
    metadata_schema_version: 3,
    correction_learning_mode: correctionLearningMode(),
  };
  if (parsed && shouldKeepParsedSnapshot) {
    baseMetadata.parsed_snapshot = buildParsedSnapshot(parsed);
  }

  const verboseSuccessMetadata = status === 'parsed' && shouldKeepVerboseSuccessMetadata();
  const finalized = (
    status === 'parsed'
    && slimSuccessLogsEnabled()
    && !verboseSuccessMetadata
  )
    ? {
        ...stripVerboseFields(baseMetadata),
        metadata_detail_level: 'slim_success',
      }
    : {
        ...baseMetadata,
        metadata_detail_level: status === 'parsed' ? 'verbose_success' : status === 'partial' ? 'partial' : 'failure',
      };

  finalized.metadata_size_bytes = estimateJsonSize(finalized);
  if (source) finalized.ingest_source = source;
  return finalized;
}

module.exports = {
  buildParsedSnapshot,
  estimateJsonSize,
  finalizeIngestMetadata,
};
