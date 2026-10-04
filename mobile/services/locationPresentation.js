function finiteCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPlaceDistance(value) {
  const meters = finiteCoordinate(value);
  if (meters == null || meters < 0) return null;
  if (meters < 160) return 'Nearby';
  const miles = meters / 1609.344;
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

function buildMapsUrl(location = {}, platform = 'ios') {
  const latitude = finiteCoordinate(location.latitude);
  const longitude = finiteCoordinate(location.longitude);
  const label = `${location.place_name || location.address || 'Selected location'}`.trim();
  const query = latitude != null && longitude != null
    ? `${latitude},${longitude}`
    : `${location.address || location.place_name || ''}`.trim();
  if (!query) return null;

  if (platform === 'ios') {
    const params = new URLSearchParams();
    if (latitude != null && longitude != null) params.set('ll', `${latitude},${longitude}`);
    params.set('q', label);
    return `https://maps.apple.com/?${params.toString()}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

module.exports = { buildMapsUrl, formatPlaceDistance };
