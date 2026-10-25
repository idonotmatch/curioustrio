const {
  normalizedLast4,
  placeIdentityKey,
} = require('../../src/services/entityResolutionService');

describe('entityResolutionService identity keys', () => {
  it('normalizes payment identifiers to the final four digits', () => {
    expect(normalizedLast4('Visa ending 1234')).toBe('1234');
    expect(normalizedLast4('12')).toBeNull();
  });

  it('prefers provider place IDs over coordinate and text fallbacks', () => {
    expect(placeIdentityKey({
      location_provider_id: 'MapKit:ABC',
      mapkit_stable_id: '35.1234,-80.1234',
      place_name: 'Market',
    })).toBe('provider:mapkit:abc');
  });

  it('uses stable rounded coordinates before a text-only place key', () => {
    expect(placeIdentityKey({
      location_latitude: 35.123456,
      location_longitude: -80.987654,
      place_name: 'Market',
    })).toBe('coordinates:35.1235,-80.9877');
  });

  it('does not treat a merchant name alone as physical-place evidence', () => {
    expect(placeIdentityKey({ merchant: 'Neighborhood Market' })).toBeNull();
  });
});
