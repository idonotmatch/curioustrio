const payloadStore = new Map();
const MAX_PAYLOADS = 50;
const PAYLOAD_TTL_MS = 15 * 60 * 1000;

function makeKey(prefix = 'payload') {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function prunePayloadStore(now = Date.now()) {
  for (const [key, entry] of payloadStore.entries()) {
    if (!entry || entry.expiresAt <= now) payloadStore.delete(key);
  }
  while (payloadStore.size >= MAX_PAYLOADS) {
    const oldestKey = payloadStore.keys().next().value;
    if (oldestKey == null) break;
    payloadStore.delete(oldestKey);
  }
}

function readPayload(key, fallback) {
  const entry = payloadStore.get(key);
  if (!entry) return fallback;
  if (entry.expiresAt <= Date.now()) {
    payloadStore.delete(key);
    return fallback;
  }
  return entry.payload ?? fallback;
}

function stashNavigationPayload(payload, prefix = 'payload') {
  prunePayloadStore();
  const key = makeKey(prefix);
  payloadStore.set(key, {
    payload,
    expiresAt: Date.now() + PAYLOAD_TTL_MS,
  });
  return key;
}

function getNavigationPayload(key, fallback = null) {
  if (!key) return fallback;
  return readPayload(key, fallback);
}

function consumeNavigationPayload(key, fallback = null) {
  if (!key) return fallback;
  const payload = readPayload(key, fallback);
  payloadStore.delete(key);
  return payload;
}

function clearNavigationPayload(key) {
  if (!key) return;
  payloadStore.delete(key);
}

function getNavigationPayloadStoreSize() {
  return payloadStore.size;
}

module.exports = {
  stashNavigationPayload,
  getNavigationPayload,
  consumeNavigationPayload,
  clearNavigationPayload,
  getNavigationPayloadStoreSize,
};
