import * as Location from 'expo-location';

export async function getLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = position.coords;

  const [geocode] = await Location.reverseGeocodeAsync({ latitude, longitude });

  const place_name = geocode?.name || geocode?.street || 'Unknown location';
  const addressParts = [geocode?.street, geocode?.city, geocode?.region].filter(Boolean);
  const address = addressParts.join(', ');
  const mapkit_stable_id = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

  return { place_name, address, mapkit_stable_id };
}
