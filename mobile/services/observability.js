const SENSITIVE_KEY_RE = /(token|secret|authorization|password|snippet|subject|body|email|from_address|message_id|ocr|receipt|address)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_RE = /\b(?:ya29|eyJ|sb_|ghp_|sk-)[A-Za-z0-9._-]{12,}\b/g;
const LONG_NUMBER_RE = /\b\d{8,}\b/g;

function redactString(value = '') {
  return `${value}`
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(TOKEN_RE, '[redacted-token]')
    .replace(LONG_NUMBER_RE, '[redacted-number]');
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[redacted-depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redact(entry, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_RE.test(key) ? '[redacted]' : redact(entry, depth + 1),
    ]));
  }
  return '[redacted]';
}

function captureException(error, context = {}) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error('[mobile-observability]', {
      message: error?.message || String(error || 'unknown_error'),
      ...redact(context),
    });
  }
}

module.exports = {
  captureException,
  redact,
  redactString,
};
