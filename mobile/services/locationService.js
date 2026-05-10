import * as Location from 'expo-location';

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
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return position.coords;
  } catch (error) {
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

  return { place_name, address, mapkit_stable_id, source: 'current', location_status: 'enriched' };
}
