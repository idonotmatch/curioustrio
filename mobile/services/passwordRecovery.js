const RESET_PASSWORD_ROUTE = '/reset-password';

let passwordRecoveryActive = false;

function parsePairs(rawValue) {
  const params = {};
  if (!rawValue) return params;
  for (const segment of `${rawValue}`.split('&')) {
    if (!segment) continue;
    const [rawKey, rawValuePart = ''] = segment.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    if (!key) continue;
    params[key] = decodeURIComponent(rawValuePart || '');
  }
  return params;
}

function normalizeRoutePath(parsedUrl) {
  const host = parsedUrl.host || '';
  const rawPath = parsedUrl.pathname || '';

  if (!rawPath && host === 'reset-password') {
    return RESET_PASSWORD_ROUTE;
  }

  if (rawPath.startsWith('/--/')) {
    return rawPath.slice(3);
  }

  return rawPath || '';
}

function parsePasswordRecoveryUrl(url) {
  if (!url) {
    return {
      isRecovery: false,
      path: '',
      code: null,
      accessToken: null,
      refreshToken: null,
      errorCode: null,
      errorDescription: null,
      type: null,
    };
  }

  try {
    const parsedUrl = new URL(url);
    const searchParams = Object.fromEntries(parsedUrl.searchParams.entries());
    const hashParams = parsePairs(parsedUrl.hash.replace(/^#/, ''));
    const params = { ...searchParams, ...hashParams };
    const type = params.type || null;
    const path = normalizeRoutePath(parsedUrl);
    const isRecovery = type === 'recovery' || path === RESET_PASSWORD_ROUTE;

    return {
      isRecovery,
      path,
      code: params.code || null,
      accessToken: params.access_token || null,
      refreshToken: params.refresh_token || null,
      errorCode: params.error_code || null,
      errorDescription: params.error_description || params.error || null,
      type,
    };
  } catch {
    return {
      isRecovery: false,
      path: '',
      code: null,
      accessToken: null,
      refreshToken: null,
      errorCode: null,
      errorDescription: null,
      type: null,
    };
  }
}

function beginPasswordRecovery() {
  passwordRecoveryActive = true;
}

function endPasswordRecovery() {
  passwordRecoveryActive = false;
}

function isPasswordRecoveryActive() {
  return passwordRecoveryActive;
}

async function applyPasswordRecoveryUrl(url, auth) {
  const parsed = parsePasswordRecoveryUrl(url);
  if (!parsed.isRecovery) return { handled: false, parsed };
  if (parsed.errorDescription) {
    throw new Error(parsed.errorDescription);
  }

  beginPasswordRecovery();

  if (parsed.code) {
    const { error } = await auth.exchangeCodeForSession(parsed.code);
    if (error) throw error;
    return { handled: true, parsed };
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (error) throw error;
    return { handled: true, parsed };
  }

  throw new Error('This password reset link is incomplete. Ask for a fresh reset email.');
}

module.exports = {
  RESET_PASSWORD_ROUTE,
  applyPasswordRecoveryUrl,
  beginPasswordRecovery,
  endPasswordRecovery,
  isPasswordRecoveryActive,
  parsePasswordRecoveryUrl,
};
