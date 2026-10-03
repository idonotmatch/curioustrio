import * as Location from 'expo-location';

const COORD_CACHE_MS = 2 * 60 * 1000;
let cachedCoords = null;
let coordsPromise = null;

async function resolveForegroundPermission({ requestIfNeeded = false } = {}) {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status === 'granted') return permission;
  if (!requestIfNeeded) return permission;
  permission = await Location.requestForegroundPermissionsAsync();
  return permission;
}

function locationError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Lightweight coords-only fetch. Uses check-only permission (no prompt).
 * Returns { latitude, longitude } or null if permission not granted.
 */
export async function getCoords(options = {}) {
  const { status } = await resolveForegroundPermission(options);
  if (status !== 'granted') {
    if (options.throwOnDenied) throw locationError('permission_denied', 'Location permission is off.');
    return null;
  }
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : COORD_CACHE_MS;
  if (cachedCoords && Date.now() - cachedCoords.capturedAt <= maxAgeMs) {
    return cachedCoords.coords;
  }
  if (coordsPromise) return coordsPromise;
  try {
    coordsPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((position) => {
        cachedCoords = { coords: position.coords, capturedAt: Date.now() };
        return position.coords;
      })
      .finally(() => {
        coordsPromise = null;
      });
    return await coordsPromise;
  } catch (error) {
    coordsPromise = null;
    if (options.throwOnFailure) throw locationError('lookup_failed', error?.message || 'Could not read current location.');
    return null;
  }
}

export async function getLocation(options = {}) {
  const { status } = await resolveForegroundPermission(options);
  if (status !== 'granted') {
    if (options.throwOnDenied) throw locationError('permission_denied', 'Location permission is off.');
    return null;
  }

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = position.coords;

  const [geocode] = await Location.reverseGeocodeAsync({ latitude, longitude });

  const place_name = geocode?.name || geocode?.street || 'Unknown location';
  const addressParts = [geocode?.street, geocode?.city, geocode?.region].filter(Boolean);
  const address = addressParts.join(', ');
  const mapkit_stable_id = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

  return {
    place_name,
    address,
    mapkit_stable_id,
    provider: 'device',
    provider_place_id: null,
    latitude,
    longitude,
    source: 'current',
    location_status: 'enriched',
    location_confidence: 1,
    location_user_owned: true,
  };
}
