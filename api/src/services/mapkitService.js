const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const MAPKIT_SEARCH_URL = 'https://maps-api.apple.com/v1/search';

let cachedJwt = null;
let jwtExpiry = 0;

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

function mapResult(top, query) {
  const place_name = top.displayLines?.[0] || query;
  const address = top.displayLines?.slice(1).join(', ') || '';
  const { latitude, longitude } = top.coordinate || {};
  const mapkit_stable_id = latitude != null && longitude != null
    ? `${latitude.toFixed(4)},${longitude.toFixed(4)}`
    : null;

  return { place_name, address, mapkit_stable_id };
}

async function searchPlaces(query, lat = null, lng = null, radiusMeters = 500, limit = 5) {
  const token = getSignedJwt();
  let hadOperationalFailure = false;
  async function searchOnce({ useLocationBias = false, includePoiFilter = false }) {
    const url = new URL(MAPKIT_SEARCH_URL);
    url.searchParams.set('q', query);
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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
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
        query,
        useLocationBias,
        includePoiFilter,
        body: responseText?.slice(0, 300) || null,
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

    return results.slice(0, limit).map((result) => mapResult(result, query));
  }

  // Try the tightest/highest-quality match first, but fall back progressively.
  // Manual search should not fail just because the user is not physically near
  // the searched location or because the query resolves better as an address
  // than a POI.
  const strategies = [
    { useLocationBias: true, includePoiFilter: true },
    { useLocationBias: true, includePoiFilter: false },
    { useLocationBias: false, includePoiFilter: true },
    { useLocationBias: false, includePoiFilter: false },
  ];

  for (const strategy of strategies) {
    let results = [];
    try {
      results = await searchOnce(strategy);
    } catch {
      hadOperationalFailure = true;
      continue;
    }
    if (results.length) return results;
  }

  if (hadOperationalFailure) {
    throw new MapkitSearchUnavailableError('Place search unavailable', `MapKit search failed for query "${query}"`);
  }

  return [];
}

async function searchPlace(query, lat = null, lng = null, radiusMeters = 500) {
  const results = await searchPlaces(query, lat, lng, radiusMeters, 1);
  return results[0] || null;
}

module.exports = { searchPlace, searchPlaces, MapkitSearchUnavailableError };
