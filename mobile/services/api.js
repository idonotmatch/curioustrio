import { supabase } from '../lib/supabase';

// Use 127.0.0.1 (not localhost) as the local fallback to force IPv4.
// `localhost` can resolve to an IPv6 address (::1 or a public 2600:... on some
// networks) which causes ENETUNREACH when the network lacks IPv6 routing.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:3001';

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
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    const enriched = new Error(`Could not reach the API at ${BASE_URL}. Make sure the local server is running.`);
    enriched.code = 'network_error';
    enriched.cause = err;
    throw enriched;
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    // Do NOT call supabase.auth.signOut() on 401 — the server may return 401
    // due to misconfiguration (e.g. missing SUPABASE_PROJECT_REF) rather than
    // a truly expired token. Supabase handles token refresh natively via
    // autoRefreshToken; a forced signOut here would cause a login loop.
    const enriched = new Error(error.error || `HTTP ${res.status}`);
    Object.assign(enriched, error);
    throw enriched;
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path, { token } = {}) => request(path, {}, token),
  post: (path, body, { token } = {}) => request(path, { method: 'POST', body: JSON.stringify(body) }, token),
  put: (path, body, { token } = {}) => request(path, { method: 'PUT', body: JSON.stringify(body) }, token),
  patch: (path, body, { token } = {}) => request(path, { method: 'PATCH', body: JSON.stringify(body) }, token),
  delete: (path, { token } = {}) => request(path, { method: 'DELETE' }, token),
};
