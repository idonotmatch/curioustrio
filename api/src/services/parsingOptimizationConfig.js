function readBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(`${raw}`.trim().toLowerCase());
}

function readNumber(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

function readMode(name, allowedValues, defaultValue) {
  const raw = `${process.env[name] || ''}`.trim().toLowerCase();
  if (!raw) return defaultValue;
  return allowedValues.includes(raw) ? raw : defaultValue;
}

function boolFlag(name, defaultValue = false) {
  return readBoolean(name, defaultValue);
}

function timeoutMs(name, defaultValue) {
  return Math.max(0, Math.round(readNumber(name, defaultValue)));
}

function ratio(name, defaultValue) {
  return Math.max(0, Math.min(1, readNumber(name, defaultValue)));
}

module.exports = {
  vendorTimeoutsEnabled() {
    return boolFlag('PARSING_VENDOR_TIMEOUTS', true);
  },
  textModelTimeoutMs() {
    return timeoutMs('PARSING_TEXT_MODEL_TIMEOUT_MS', 8000);
  },
  imageModelTimeoutMs() {
    return timeoutMs('PARSING_IMAGE_MODEL_TIMEOUT_MS', 14000);
  },
  mapkitTimeoutMs() {
    return timeoutMs('PARSING_MAPKIT_TIMEOUT_MS', 2500);
  },
  slimSuccessLogsEnabled() {
    return boolFlag('PARSING_SUCCESS_LOG_SLIM', true);
  },
  verboseSuccessSampleRate() {
    return ratio('PARSING_VERBOSE_SUCCESS_SAMPLE_RATE', 0.1);
  },
  asyncPlaceEnrichmentEnabled() {
    return boolFlag('PARSING_ASYNC_PLACE_ENRICHMENT', true);
  },
  strictCategoryFallbackEnabled() {
    return boolFlag('PARSING_CATEGORY_AI_FALLBACK_STRICT', true);
  },
  nlFastPathMode() {
    return readMode('PARSING_NL_FAST_PATH_MODE', ['off', 'shadow', 'enabled'], 'enabled');
  },
  receiptRetryPolicyMode() {
    return readMode('PARSING_RECEIPT_SINGLE_RETRY_POLICY_MODE', ['legacy', 'single'], 'single');
  },
  receiptFamilyStrategiesMode() {
    return readMode('PARSING_RECEIPT_FAMILY_STRATEGIES_MODE', ['off', 'shadow', 'enabled'], 'shadow');
  },
  enrichmentCacheEnabled() {
    return boolFlag('PARSING_ENRICHMENT_CACHE', false);
  },
  enrichmentCacheTtlMs() {
    return timeoutMs('PARSING_ENRICHMENT_CACHE_TTL_MS', 10 * 60 * 1000);
  },
  correctionLearningMode() {
    return readMode('PARSING_CORRECTION_LEARNING_MODE', ['off', 'observe'], 'observe');
  },
};
