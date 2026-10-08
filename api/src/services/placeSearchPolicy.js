function distanceMeters(originLat, originLng, latitude, longitude) {
  const rawValues = [originLat, originLng, latitude, longitude];
  if (rawValues.some((value) => value == null || value === '')) return null;
  const values = rawValues.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [fromLat, fromLng, toLat, toLng] = values;
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function withPlaceDistances(places = [], lat = null, lng = null) {
  return places.map((place) => ({
    ...place,
    distance_meters: distanceMeters(lat, lng, place.latitude, place.longitude),
  }));
}

function learnedPlacesForIntent(places = [], {
  intent = 'manual',
  lat = null,
  lng = null,
  radiusMeters = 500,
} = {}) {
  const hasOrigin = lat != null && lat !== '' && lng != null && lng !== ''
    && [Number(lat), Number(lng)].every(Number.isFinite);
  if (intent !== 'auto' || !hasOrigin) return places;
  return places.filter((place) => (
    place.distance_meters != null
    && place.distance_meters !== ''
    && Number.isFinite(Number(place.distance_meters))
    && Number(place.distance_meters) <= radiusMeters
  ));
}

module.exports = {
  distanceMeters,
  withPlaceDistances,
  learnedPlacesForIntent,
};
