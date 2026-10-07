import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

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

let initialized = false;
let enabled = false;

function updateGroupId() {
  const manifest = Updates.manifest;
  const metadata = manifest && typeof manifest === 'object' && 'metadata' in manifest
    ? manifest.metadata
    : null;
  return metadata && typeof metadata === 'object' ? metadata.updateGroup || null : null;
}

function initObservability() {
  if (initialized) return enabled;
  initialized = true;
  const dsn = `${process.env.EXPO_PUBLIC_SENTRY_DSN || ''}`.trim();
  enabled = dsn.length > 0;

  Sentry.init({
    dsn: dsn || undefined,
    enabled,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend(event) {
      return redact(event);
    },
  });

  if (enabled) {
    Sentry.setTag('expo-update-id', Updates.updateId || 'embedded');
    Sentry.setTag('expo-is-embedded-update', `${Updates.isEmbeddedLaunch === true}`);
    const groupId = updateGroupId();
    if (groupId) Sentry.setTag('expo-update-group-id', `${groupId}`);
  }

  return enabled;
}

function captureException(error, context = {}) {
  const safeContext = redact(context);
  if (enabled) {
    Sentry.withScope((scope) => {
      scope.setContext('adlo', safeContext);
      Sentry.captureException(error);
    });
    return;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.error('[mobile-observability]', {
      message: error?.message || String(error || 'unknown_error'),
      ...safeContext,
    });
  }
}

function wrapRootComponent(Component) {
  return enabled ? Sentry.wrap(Component) : Component;
}

export {
  captureException,
  initObservability,
  redact,
  redactString,
  wrapRootComponent,
};
