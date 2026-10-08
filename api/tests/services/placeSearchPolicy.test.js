const {
  distanceMeters,
  withPlaceDistances,
  learnedPlacesForIntent,
} = require('../../src/services/placeSearchPolicy');

describe('placeSearchPolicy', () => {
  it('adds distance from current coordinates to learned places', () => {
    const [place] = withPlaceDistances([{
      place_name: 'Corner Market',
      latitude: 36.0999,
      longitude: -80.2442,
    }], 36.1, -80.244);

    expect(place.distance_meters).toBeGreaterThanOrEqual(0);
    expect(place.distance_meters).toBeLessThan(100);
  });

  it('keeps only nearby history for automatic merchant matching', () => {
    const nearby = { place_name: 'Nearby Target', distance_meters: 420 };
    const oldLocation = { place_name: 'Old Target', distance_meters: 9200 };
    const noCoordinates = { place_name: 'Unknown Target', distance_meters: null };

    expect(learnedPlacesForIntent([nearby, oldLocation, noCoordinates], {
      intent: 'auto',
      lat: 36.1,
      lng: -80.244,
      radiusMeters: 2000,
    })).toEqual([nearby]);
  });

  it('preserves learned places for an explicit manual search', () => {
    const places = [{ place_name: 'Old Target', distance_meters: 9200 }];
    expect(learnedPlacesForIntent(places, {
      intent: 'manual',
      lat: 36.1,
      lng: -80.244,
      radiusMeters: 2000,
    })).toEqual(places);
  });

  it('returns null distance when coordinates are incomplete', () => {
    expect(distanceMeters(36.1, -80.244, null, null)).toBeNull();
  });
});
