export const FRESHNESS_DOMAINS = Object.freeze({
  expenses: 'expenses',
  householdExpenses: 'householdExpenses',
  budget: 'budget',
  pendingExpenses: 'pendingExpenses',
  insights: 'insights',
  forecastMovement: 'forecastMovement',
  gmailImport: 'gmailImport',
  household: 'household',
  categories: 'categories',
  recurring: 'recurring',
  watchedPlans: 'watchedPlans',
});

const DEFAULT_REFRESH_DELAY_MS = 450;

const listenersByDomain = new Map();
const staleVersions = new Map();

function normalizeDomains(domains) {
  return (Array.isArray(domains) ? domains : [domains]).filter(Boolean);
}

function currentVersion(domain) {
  return staleVersions.get(domain) || 0;
}

function addListener(domain, listener) {
  if (!listenersByDomain.has(domain)) listenersByDomain.set(domain, new Set());
  listenersByDomain.get(domain).add(listener);
}

function removeListener(domain, listener) {
  const listeners = listenersByDomain.get(domain);
  if (!listeners) return;
  listeners.delete(listener);
  if (listeners.size === 0) listenersByDomain.delete(domain);
}

function staleDomainsForListener(listener) {
  return listener.domains.filter((domain) => (listener.seenVersions.get(domain) || 0) < currentVersion(domain));
}

function scheduleListener(listener, delayMs = DEFAULT_REFRESH_DELAY_MS, reason = 'data_changed') {
  if (listener.disposed) return;
  if (listener.timer) clearTimeout(listener.timer);
  if (listener.running) {
    listener.refreshAfterRun = true;
    listener.nextDelayMs = delayMs;
    listener.nextReason = reason;
    return;
  }

  listener.timer = setTimeout(async () => {
    listener.timer = null;
    if (listener.disposed) return;
    const domains = staleDomainsForListener(listener);
    if (!domains.length) return;

    const requestedVersions = new Map(domains.map((domain) => [domain, currentVersion(domain)]));
    listener.running = true;
    try {
      const outcome = await listener.refresh({ domains, reason, forceRefresh: true });
      if (!listener.disposed && outcome?.refreshSucceeded !== false) {
        requestedVersions.forEach((version, domain) => {
          listener.seenVersions.set(domain, Math.max(listener.seenVersions.get(domain) || 0, version));
        });
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[freshness] quiet refresh failed', err?.message || err);
      }
    } finally {
      listener.running = false;
      const refreshAfterRun = listener.refreshAfterRun;
      const nextDelayMs = listener.nextDelayMs;
      const nextReason = listener.nextReason;
      listener.refreshAfterRun = false;
      listener.nextDelayMs = null;
      listener.nextReason = null;
      if (!listener.disposed && refreshAfterRun && staleDomainsForListener(listener).length) {
        scheduleListener(listener, nextDelayMs, nextReason);
      }
    }
  }, Math.max(0, Number(delayMs) || 0));
}

export function registerFreshnessHandler(domains, refresh, options = {}) {
  const normalizedDomains = normalizeDomains(domains);
  if (!normalizedDomains.length || typeof refresh !== 'function') return () => {};

  const listener = {
    domains: normalizedDomains,
    refresh,
    seenVersions: new Map(normalizedDomains.map((domain) => [
      domain,
      options.refreshIfStale ? Math.max(0, currentVersion(domain) - 1) : currentVersion(domain),
    ])),
    timer: null,
    running: false,
    refreshAfterRun: false,
    nextDelayMs: null,
    nextReason: null,
    disposed: false,
  };

  normalizedDomains.forEach((domain) => addListener(domain, listener));

  if (options.refreshIfStale) {
    scheduleListener(listener, options.delayMs, options.reason || 'handler_registered');
  }

  return () => {
    listener.disposed = true;
    if (listener.timer) clearTimeout(listener.timer);
    normalizedDomains.forEach((domain) => removeListener(domain, listener));
  };
}

export function markFreshnessStale(domains, options = {}) {
  const normalizedDomains = normalizeDomains(domains);
  if (!normalizedDomains.length) return [];

  const affectedListeners = new Set();
  normalizedDomains.forEach((domain) => {
    staleVersions.set(domain, currentVersion(domain) + 1);
    const listeners = listenersByDomain.get(domain);
    if (listeners) listeners.forEach((listener) => affectedListeners.add(listener));
  });

  affectedListeners.forEach((listener) => {
    scheduleListener(listener, options.delayMs, options.reason || 'data_changed');
  });

  return normalizedDomains;
}

export function domainsForExpenseMutation({ includePending = true, includeInsights = true } = {}) {
  const domains = [
    FRESHNESS_DOMAINS.expenses,
    FRESHNESS_DOMAINS.householdExpenses,
    FRESHNESS_DOMAINS.budget,
    FRESHNESS_DOMAINS.forecastMovement,
  ];
  if (includePending) domains.push(FRESHNESS_DOMAINS.pendingExpenses);
  if (includePending) domains.push(FRESHNESS_DOMAINS.gmailImport);
  if (includeInsights) domains.push(FRESHNESS_DOMAINS.insights);
  return domains;
}

export function getFreshnessSnapshot() {
  return Object.fromEntries(staleVersions.entries());
}
