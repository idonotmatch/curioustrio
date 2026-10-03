const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { withTimeout, VendorTimeoutError } = require('./ai');
const {
  mapkitTimeoutMs,
  enrichmentCacheEnabled,
  enrichmentCacheTtlMs,
} = require('./parsingOptimizationConfig');
const { captureException } = require('./observability');

const MAPKIT_SEARCH_URL = 'https://maps-api.apple.com/v1/search';

let cachedJwt = null;
let jwtExpiry = 0;
const searchCache = new Map();
const inFlightSearches = new Map();
const MAX_CACHE_ENTRIES = 500;

class MapkitSearchUnavailableError extends Error {
  constructor(message = 'Place search unavailable', details = null) {
    super(message);
    this.name = 'MapkitSearchUnavailableError';
    this.details = details;
  }
}

function getSignedJwt() {
  // Cache for up to 25 minutes (JWT signed for 30m)
  if (cachedJwt && Date.now() < jwtExpiry - 60_000) return cachedJwt;

  const { APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, APPLE_MAPS_PRIVATE_KEY } = process.env;
  if (!APPLE_MAPS_KEY_ID || !APPLE_MAPS_TEAM_ID || !APPLE_MAPS_PRIVATE_KEY) {
    throw new MapkitSearchUnavailableError(
      'Apple Maps credentials not configured',
      'Missing APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, or APPLE_MAPS_PRIVATE_KEY'
    );
  }

  // Render env vars store the .p8 key with literal \n strings instead of
  // real newlines. jsonwebtoken requires actual newlines to parse an EC key.
  const privateKey = APPLE_MAPS_PRIVATE_KEY.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  try {
    cachedJwt = jwt.sign(
      { iss: APPLE_MAPS_TEAM_ID, iat: now, exp: now + 1800 },
      privateKey,
      { algorithm: 'ES256', keyid: APPLE_MAPS_KEY_ID }
    );
  } catch (error) {
    throw new MapkitSearchUnavailableError('Apple Maps token signing failed', error?.message || null);
  }
  jwtExpiry = Date.now() + 1800 * 1000;
  return cachedJwt;
}

function metersToDegrees(meters, lat) {
  const latDeg = meters / 111320;
  const lngDeg = meters / (111320 * Math.cos(lat * Math.PI / 180));
  return { latDeg, lngDeg };
}

function distanceMeters(originLat, originLng, latitude, longitude) {
  if (![originLat, originLng, latitude, longitude].every(Number.isFinite)) return null;
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const latDelta = toRadians(latitude - originLat);
  const lngDelta = toRadians(longitude - originLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(originLat)) * Math.cos(toRadians(latitude)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function mapResult(top, query, { originLat = null, originLng = null, strategy = 'unknown' } = {}) {
  const place_name = top.name || top.displayLines?.[0] || query;
  const address = Array.isArray(top.formattedAddressLines)
    ? top.formattedAddressLines.join(', ')
    : top.displayLines?.slice(1).join(', ') || '';
  const { latitude, longitude } = top.coordinate || {};
  const mapkit_stable_id = latitude != null && longitude != null
    ? `${latitude.toFixed(4)},${longitude.toFixed(4)}`
    : null;

  return {
    place_name,
    address,
    mapkit_stable_id,
    provider: 'apple_maps',
    provider_place_id: top.id || top.muid || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    distance_meters: distanceMeters(originLat, originLng, latitude, longitude),
    search_strategy: strategy,
  };
}

function cacheKey({ query, lat, lng, radiusMeters, limit }) {
  return JSON.stringify({
    query: `${query || ''}`.trim().toLowerCase(),
    lat: lat == null ? null : Number(lat).toFixed(3),
    lng: lng == null ? null : Number(lng).toFixed(3),
    radiusMeters,
    limit,
  });
}

function readCachedResults(key) {
  if (!enrichmentCacheEnabled()) return null;
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCachedResults(key, value) {
  if (!enrichmentCacheEnabled()) return;
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey) searchCache.delete(oldestKey);
  }
  searchCache.set(key, {
    value,
    expiresAt: Date.now() + enrichmentCacheTtlMs(),
  });
}

async function runPlaceSearch(query, lat = null, lng = null, radiusMeters = 500, limit = 5, options = {}) {
  const normalizedQuery = `${query || ''}`.trim();
  const token = getSignedJwt();
  let hadOperationalFailure = false;
  async function searchOnce({ useLocationBias = false, includePoiFilter = false, strategy = 'unknown' }) {
    const url = new URL(MAPKIT_SEARCH_URL);
    url.searchParams.set('q', normalizedQuery);
    if (useLocationBias && lat != null && lng != null) {
      url.searchParams.set('userLocation', `${lat},${lng}`);
      url.searchParams.set('searchLocation', `${lat},${lng}`);
      const { latDeg, lngDeg } = metersToDegrees(radiusMeters, lat);
      const north = lat + latDeg, south = lat - latDeg;
      const east = lng + lngDeg, west = lng - lngDeg;
      url.searchParams.set('searchRegion', `${north},${east},${south},${west}`);
    }
    url.searchParams.set('limitToCountries', 'US');
    if (includePoiFilter) {
      url.searchParams.set('resultTypeFilter', 'Poi');
    }
    url.searchParams.set('lang', 'en-US');

    const controller = new AbortController();
    const res = await withTimeout(fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }), {
      service: 'mapkit_search',
      timeoutMs: mapkitTimeoutMs(),
      onTimeout: () => controller.abort(),
    });
    if (!res.ok) {
      hadOperationalFailure = true;
      let responseText = '';
      try {
        responseText = await res.text();
      } catch {
        responseText = '';
      }
      console.error('[places/search] Apple Maps HTTP error', {
        status: res.status,
        statusText: res.statusText,
        query_present: !!normalizedQuery,
        query_length: normalizedQuery.length,
        useLocationBias,
        includePoiFilter,
        body_present: !!responseText,
      });
      captureException(new MapkitSearchUnavailableError('Apple Maps HTTP error'), {
        area: 'mapkit_search',
        status: res.status,
        query_present: !!normalizedQuery,
        query_length: normalizedQuery.length,
        useLocationBias,
        includePoiFilter,
      });
      return [];
    }

    let data;
    try {
      data = await res.json();
    } catch {
      hadOperationalFailure = true;
      return [];
    }
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return [];

    return results.slice(0, limit).map((result) => mapResult(result, normalizedQuery, {
      originLat: lat,
      originLng: lng,
      strategy,
    }));
  }

  const hasLocationBias = lat != null && lng != null;
  const automatic = options.intent === 'auto';
  const strategies = hasLocationBias
    ? automatic
      ? [
          { useLocationBias: true, includePoiFilter: true, strategy: 'nearby_poi' },
          { useLocationBias: true, includePoiFilter: false, strategy: 'nearby_any' },
        ]
      : [
          { useLocationBias: true, includePoiFilter: true, strategy: 'nearby_poi' },
          { useLocationBias: false, includePoiFilter: false, strategy: 'broad_any' },
        ]
    : [
        { useLocationBias: false, includePoiFilter: true, strategy: 'poi' },
        { useLocationBias: false, includePoiFilter: false, strategy: 'broad_any' },
      ];

  for (const strategy of strategies) {
    let results = [];
    try {
      results = await searchOnce(strategy);
    } catch (error) {
      if (error instanceof VendorTimeoutError) {
        hadOperationalFailure = true;
        continue;
      }
      hadOperationalFailure = true;
      continue;
    }
    if (results.length) {
      return results;
    }
  }

  if (hadOperationalFailure) {
    throw new MapkitSearchUnavailableError('Place search unavailable', `MapKit search failed for query "${normalizedQuery}"`);
  }

  return [];
}

async function searchPlaces(query, lat = null, lng = null, radiusMeters = 500, limit = 5, options = {}) {
  const normalizedQuery = `${query || ''}`.trim();
  const key = `${cacheKey({ query: normalizedQuery, lat, lng, radiusMeters, limit })}:${options.intent || 'manual'}`;
  const cached = readCachedResults(key);
  if (cached) return cached;
  if (inFlightSearches.has(key)) return inFlightSearches.get(key);

  const pending = runPlaceSearch(normalizedQuery, lat, lng, radiusMeters, limit, options)
    .then((results) => {
      if (results.length) writeCachedResults(key, results);
      return results;
    })
    .finally(() => inFlightSearches.delete(key));
  inFlightSearches.set(key, pending);
  return pending;
}

async function searchPlace(query, lat = null, lng = null, radiusMeters = 500, options = {}) {
  const results = await searchPlaces(query, lat, lng, radiusMeters, 1, options);
  return results[0] || null;
}

module.exports = { searchPlace, searchPlaces, MapkitSearchUnavailableError };
