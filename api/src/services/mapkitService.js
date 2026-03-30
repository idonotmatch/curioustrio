const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const MAPKIT_SEARCH_URL = 'https://maps-api.apple.com/v1/search';

let cachedJwt = null;
let jwtExpiry = 0;

function getSignedJwt() {
  // Cache for up to 25 minutes (JWT signed for 30m)
  if (cachedJwt && Date.now() < jwtExpiry - 60_000) return cachedJwt;

  const { APPLE_MAPS_KEY_ID, APPLE_MAPS_TEAM_ID, APPLE_MAPS_PRIVATE_KEY } = process.env;
  if (!APPLE_MAPS_KEY_ID || !APPLE_MAPS_TEAM_ID || !APPLE_MAPS_PRIVATE_KEY) {
    throw new Error('Apple Maps credentials not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  cachedJwt = jwt.sign(
    { iss: APPLE_MAPS_TEAM_ID, iat: now, exp: now + 1800 },
    APPLE_MAPS_PRIVATE_KEY,
    { algorithm: 'ES256', keyid: APPLE_MAPS_KEY_ID }
  );
  jwtExpiry = Date.now() + 1800 * 1000;
  return cachedJwt;
}

async function searchPlace(query, lat, lng) {
  const token = getSignedJwt();
  const url = new URL(MAPKIT_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('userLocation', `${lat},${lng}`);
  url.searchParams.set('limitToCountries', 'US');
  url.searchParams.set('resultTypeFilter', 'Poi');
  url.searchParams.set('lang', 'en-US');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const top = data.results?.[0];
  if (!top) return null;

  const place_name = top.displayLines?.[0] || query;
  const address = top.displayLines?.slice(1).join(', ') || '';
  const { latitude, longitude } = top.coordinate || {};
  const mapkit_stable_id = latitude != null
    ? `${latitude.toFixed(4)},${longitude.toFixed(4)}`
    : null;

  return { place_name, address, mapkit_stable_id };
}

module.exports = { searchPlace };
