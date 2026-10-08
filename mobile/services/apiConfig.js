function deriveExpoHostBaseUrlsFromCandidates(candidates = []) {
  const normalizedCandidates = Array.isArray(candidates) ? candidates.filter(Boolean) : [];

  for (const candidate of normalizedCandidates) {
    const raw = `${candidate || ''}`.trim();
    const host = raw.split('://').pop()?.split('/')[0]?.split(':')[0];
    if (!host || host === '127.0.0.1' || host === 'localhost') continue;
    return [`http://${host}:3001`, `http://${host}:3002`];
  }

  return [];
}

function buildCandidateBaseUrls({
  explicitBaseUrl = null,
  allowLocalFallback = false,
  expoHostCandidates = [],
  localBaseUrls = [],
  activeBaseUrl = null,
} = {}) {
  const normalizedExplicitBaseUrl = `${explicitBaseUrl || ''}`.trim() || null;
  if (normalizedExplicitBaseUrl) return [normalizedExplicitBaseUrl];
  if (!allowLocalFallback) return [];

  const derivedBaseUrls = deriveExpoHostBaseUrlsFromCandidates(expoHostCandidates);
  const fallbackBaseUrls = Array.isArray(localBaseUrls) ? localBaseUrls.filter(Boolean) : [];
  const allLocalBaseUrls = [...derivedBaseUrls, ...fallbackBaseUrls]
    .filter((url, index, arr) => arr.indexOf(url) === index);

  if (activeBaseUrl && allLocalBaseUrls.includes(activeBaseUrl)) {
    return [activeBaseUrl, ...allLocalBaseUrls.filter((url) => url !== activeBaseUrl)];
  }
  return allLocalBaseUrls;
}

function missingApiBaseUrlMessage({ allowLocalFallback = false, explicitBaseUrl = null } = {}) {
  if (`${explicitBaseUrl || ''}`.trim()) return null;
  if (allowLocalFallback) return null;
  return 'This build is missing EXPO_PUBLIC_API_URL. Set it before shipping a user-ready build.';
}

function parseHttpErrorResponse({ status, body = '' } = {}) {
  const normalizedStatus = Number(status) || 0;
  const normalizedBody = `${body || ''}`.trim();

  if (normalizedBody) {
    try {
      const parsed = JSON.parse(normalizedBody);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          ...parsed,
          error: parsed.error || parsed.message || `Request failed (HTTP ${normalizedStatus})`,
        };
      }
    } catch {
      // Some hosts return HTML or plain text for routing and proxy failures.
    }
  }

  if (normalizedStatus === 404) {
    return {
      error: 'This feature is not available on the current server version yet.',
      code: 'server_route_unavailable',
    };
  }

  return {
    error: normalizedStatus
      ? `Request failed (HTTP ${normalizedStatus})`
      : 'Request failed',
  };
}

module.exports = {
  buildCandidateBaseUrls,
  deriveExpoHostBaseUrlsFromCandidates,
  missingApiBaseUrlMessage,
  parseHttpErrorResponse,
};
