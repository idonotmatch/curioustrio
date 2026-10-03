function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

export function normalizeLocationData(location, defaults = {}) {
  if (!location) return null;
  const status = firstDefined(location.status, location.location_status, defaults.status, null);
  const confidence = firstDefined(location.confidence, location.location_confidence, defaults.confidence, null);
  const source = firstDefined(location.source, location.location_source, defaults.source, null);
  const providerPlaceId = firstDefined(location.provider_place_id, location.location_provider_id, null);
  const latitude = firstDefined(location.latitude, location.location_latitude, null);
  const longitude = firstDefined(location.longitude, location.location_longitude, null);
  const userOwned = Boolean(firstDefined(location.location_user_owned, defaults.location_user_owned, false));

  return {
    place_name: location.place_name || '',
    address: location.address || null,
    mapkit_stable_id: location.mapkit_stable_id || null,
    provider: location.provider || null,
    provider_place_id: providerPlaceId,
    latitude,
    longitude,
    source,
    status,
    confidence,
    location_status: status,
    location_confidence: confidence,
    location_user_owned: userOwned,
    distance_meters: firstDefined(location.distance_meters, null),
    search_strategy: location.search_strategy || null,
  };
}

export function locationApiFields(location, { cleared = false } = {}) {
  const normalized = normalizeLocationData(location, {
    source: cleared ? 'user_cleared' : 'manual_edit',
    status: cleared ? 'cleared' : 'enriched',
    confidence: cleared ? null : 1,
    location_user_owned: true,
  });

  return {
    place_name: normalized?.place_name || null,
    address: normalized?.address || null,
    mapkit_stable_id: normalized?.mapkit_stable_id || null,
    location_provider_id: normalized?.provider_place_id || null,
    location_latitude: normalized?.latitude ?? null,
    location_longitude: normalized?.longitude ?? null,
    location_source: normalized?.source || (cleared ? 'user_cleared' : 'manual_edit'),
    location_status: normalized?.status || (cleared ? 'cleared' : 'enriched'),
    location_confidence: normalized?.confidence ?? (cleared ? null : 1),
    location_user_owned: true,
  };
}
