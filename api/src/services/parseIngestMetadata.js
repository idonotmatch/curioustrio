const {
  slimSuccessLogsEnabled,
  verboseSuccessSampleRate,
  correctionLearningMode,
} = require('./parsingOptimizationConfig');

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
    category_id: parsed?.category_id || null,
    category_source: parsed?.category_source || null,
    place_name: parsed?.place_name || null,
    address: parsed?.address || parsed?.store_address || null,
    mapkit_stable_id: parsed?.mapkit_stable_id || null,
    item_count: Array.isArray(parsed?.items) ? parsed.items.length : 0,
    review_fields: Array.isArray(parsed?.review_fields) ? parsed.review_fields : [],
    parse_status: parsed?.parse_status || null,
  };
}

function shouldKeepVerboseSuccessMetadata() {
  return Math.random() < verboseSuccessSampleRate();
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

function finalizeIngestMetadata({
  status,
  metadata = {},
  parsed = null,
  source = null,
}) {
  const baseMetadata = {
    ...(metadata || {}),
    parsed_snapshot: parsed ? buildParsedSnapshot(parsed) : null,
    metadata_schema_version: 2,
    correction_learning_mode: correctionLearningMode(),
  };

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
