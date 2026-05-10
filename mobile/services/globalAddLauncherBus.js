const listeners = new Set();

export function subscribeGlobalAddLauncher(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestGlobalAddLauncher() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // non-fatal
    }
  });
}
