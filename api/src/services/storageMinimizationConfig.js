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

function clampInt(value, min, max, fallback) {
  const candidate = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, candidate));
}

module.exports = {
  gmailMinimalLogModeEnabled() {
    return readBoolean('GMAIL_MINIMAL_LOG_MODE', true);
  },
  emailImportRetentionDays() {
    return clampInt(readNumber('EMAIL_IMPORT_RETENTION_DAYS', 45), 7, 365, 45);
  },
  ingestFailureRetentionDays() {
    return clampInt(readNumber('INGEST_FAILURE_RETENTION_DAYS', 30), 7, 365, 30);
  },
  ingestSuccessRetentionDays() {
    return clampInt(readNumber('INGEST_SUCCESS_RETENTION_DAYS', 14), 1, 180, 14);
  },
  persistSuccessParsedSnapshotSampleRate() {
    const raw = readNumber('INGEST_SUCCESS_PARSED_SNAPSHOT_SAMPLE_RATE', 0.02);
    return Math.max(0, Math.min(1, raw));
  },
  persistSuccessInputPreviewEnabled() {
    return readBoolean('INGEST_SUCCESS_INPUT_PREVIEW', false);
  },
  persistPaymentCorrectionTelemetryEnabled() {
    return readBoolean('INGEST_PAYMENT_CORRECTION_TELEMETRY', false);
  },
};
