import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
const {
  buildCandidateBaseUrls,
  missingApiBaseUrlMessage,
  parseHttpErrorResponse,
} = require('./apiConfig');

// Use 127.0.0.1 (not localhost) as the local fallback to force IPv4.
// `localhost` can resolve to an IPv6 address (::1 or a public 2600:... on some
// networks) which causes ENETUNREACH when the network lacks IPv6 routing.
const EXPLICIT_BASE_URL = `${process.env.EXPO_PUBLIC_API_URL || ''}`.trim() || null;
const LOCAL_BASE_URLS = ['http://127.0.0.1:3001', 'http://127.0.0.1:3002'];
let activeBaseUrl = EXPLICIT_BASE_URL;
const inFlightGets = new Map();
const DEFAULT_GET_TIMEOUT_MS = 20000;
const DEFAULT_MUTATION_TIMEOUT_MS = 45000;

function deriveExpoHostBaseUrls() {
  return [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.developer?.tool,
    Constants.manifest2?.extra?.expoGo?.developer?.tool,
    Constants.manifest?.debuggerHost,
  ].filter(Boolean);
}

function candidateBaseUrls() {
  return buildCandidateBaseUrls({
    explicitBaseUrl: EXPLICIT_BASE_URL,
    allowLocalFallback: __DEV__,
    expoHostCandidates: deriveExpoHostBaseUrls(),
    localBaseUrls: LOCAL_BASE_URLS,
    activeBaseUrl,
  });
}

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function request(path, options = {}, tokenOverride) {
  // tokenOverride lets callers pass a token they already have in memory,
  // avoiding a round-trip through AsyncStorage. This is necessary right after
  // sign-in: the session is in memory but may not yet be flushed to storage,
  // so supabase.auth.getSession() can return null and produce a spurious 401.
  const token = tokenOverride !== undefined ? tokenOverride : await getToken();
  let lastNetworkError = null;

  const configMessage = missingApiBaseUrlMessage({
    allowLocalFallback: __DEV__,
    explicitBaseUrl: EXPLICIT_BASE_URL,
  });
  if (configMessage) {
    const configError = new Error(configMessage);
    configError.code = 'network_error';
    throw configError;
  }

  for (const baseUrl of candidateBaseUrls()) {
    const timeoutMs = Math.max(
      1000,
      Number(options.timeoutMs || (options.method ? DEFAULT_MUTATION_TIMEOUT_MS : DEFAULT_GET_TIMEOUT_MS))
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...options,
        timeoutMs: undefined,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      activeBaseUrl = baseUrl;

      if (!res.ok) {
        const responseBody = await res.text().catch(() => '');
        const error = parseHttpErrorResponse({ status: res.status, body: responseBody });
        // Do NOT call supabase.auth.signOut() on 401 — the server may return 401
        // due to misconfiguration (e.g. missing SUPABASE_PROJECT_REF) rather than
        // a truly expired token. Supabase handles token refresh natively via
        // autoRefreshToken; a forced signOut here would cause a login loop.
        const enriched = new Error(error.error || `HTTP ${res.status}`);
        Object.assign(enriched, error, {
          status: res.status,
          retryAfter: res.headers.get('retry-after') || null,
          requestId: res.headers.get('x-request-id') || null,
        });
        throw enriched;
      }

      if (res.status === 204) return null;
      return res.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err?.code === 'network_error' || err instanceof TypeError) {
        lastNetworkError = err;
        continue;
      }
      if (err?.name === 'AbortError') {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutError.code = 'request_timeout';
        timeoutError.status = 408;
        timeoutError.cause = err;
        lastNetworkError = timeoutError;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  const targets = candidateBaseUrls().join(' or ');
  const message = lastNetworkError?.code === 'request_timeout'
    ? lastNetworkError.message
    : __DEV__
    ? `Could not reach the API at ${targets}. Make sure the local server is running.`
    : `Could not reach the API at ${targets}. Please check the app's API configuration.`;
  const enriched = new Error(message);
  enriched.code = lastNetworkError?.code || 'network_error';
  enriched.status = lastNetworkError?.status || null;
  enriched.cause = lastNetworkError;
  throw enriched;
}

export const api = {
  get: async (path, { token, dedupe = true } = {}) => {
    const resolvedToken = token !== undefined ? token : await getToken();
    if (!dedupe) return request(path, {}, resolvedToken);

    const key = `${resolvedToken || 'anonymous'}:${path}`;
    const existing = inFlightGets.get(key);
    if (existing) return existing;

    const run = async () => {
      try {
        return await request(path, {}, resolvedToken);
      } catch (err) {
        if (err?.status !== 429) throw err;
        const retryAfterSeconds = Number.parseFloat(err.retryAfter);
        const delayMs = Math.min(3000, Math.max(500, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return request(path, {}, resolvedToken);
      }
    };
    const pending = run()
      .finally(() => inFlightGets.delete(key));
    inFlightGets.set(key, pending);
    return pending;
  },
  post: (path, body, { token } = {}) => request(path, { method: 'POST', body: JSON.stringify(body) }, token),
  put: (path, body, { token } = {}) => request(path, { method: 'PUT', body: JSON.stringify(body) }, token),
  patch: (path, body, { token } = {}) => request(path, { method: 'PATCH', body: JSON.stringify(body) }, token),
  delete: (path, { token } = {}) => request(path, { method: 'DELETE' }, token),
};
