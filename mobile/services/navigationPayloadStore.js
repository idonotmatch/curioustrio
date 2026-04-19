const payloadStore = new Map();

function makeKey(prefix = 'payload') {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

export function stashNavigationPayload(payload, prefix = 'payload') {
  const key = makeKey(prefix);
  payloadStore.set(key, payload);
  return key;
}

export function getNavigationPayload(key, fallback = null) {
  if (!key) return fallback;
  return payloadStore.get(key) ?? fallback;
}

export function consumeNavigationPayload(key, fallback = null) {
  if (!key) return fallback;
  const payload = payloadStore.get(key);
  if (payloadStore.has(key)) payloadStore.delete(key);
  return payload ?? fallback;
}

export function clearNavigationPayload(key) {
  if (!key) return;
  payloadStore.delete(key);
}
