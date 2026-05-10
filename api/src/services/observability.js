const SENSITIVE_KEY_RE = /(token|secret|authorization|password|snippet|subject|body|email|from_address|message_id|ocr|receipt|address)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_RE = /\b(?:ya29|eyJ|sb_|ghp_|sk-)[A-Za-z0-9._-]{12,}\b/g;
const LONG_NUMBER_RE = /\b\d{8,}\b/g;

let sentryClient = null;

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

function initObservability() {
  if (process.env.NODE_ENV === 'test' || !process.env.SENTRY_DSN) return null;
  try {
    // Optional dependency: production can install @sentry/node without making
    // local/dev builds depend on it.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version || undefined,
      beforeSend(event) {
        return redact(event);
      },
    });
    sentryClient = Sentry;
    return Sentry;
  } catch {
    sentryClient = null;
    return null;
  }
}

function captureException(error, context = {}) {
  const safeContext = redact(context);
  if (sentryClient?.captureException) {
    sentryClient.captureException(error, { extra: safeContext });
    return;
  }
  if (process.env.NODE_ENV !== 'test') {
    console.error('[observability]', {
      message: error?.message || String(error || 'unknown_error'),
      ...safeContext,
    });
  }
}

module.exports = {
  captureException,
  initObservability,
  redact,
  redactString,
};
