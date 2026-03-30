jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
}));
jest.mock('node-fetch');

const { searchPlace } = require('../../src/services/mapkitService');
const fetch = require('node-fetch');

beforeEach(() => {
  process.env.APPLE_MAPS_KEY_ID = 'test-key-id';
  process.env.APPLE_MAPS_TEAM_ID = 'test-team-id';
  process.env.APPLE_MAPS_PRIVATE_KEY = 'fake-key';
  fetch.mockReset();
  // Reset cached JWT so getSignedJwt re-signs on each test
  jest.resetModules();
});

it('returns top place result from MapKit search', async () => {
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: [{
        displayLines: ["Trader Joe's", '123 Main St, San Francisco, CA'],
        coordinate: { latitude: 37.7749, longitude: -122.4194 },
      }],
    }),
  });

  const result = await searchPlace("Trader Joe's", 37.775, -122.419);
  expect(result).not.toBeNull();
  expect(result.place_name).toBe("Trader Joe's");
  expect(result.address).toContain('123 Main St');
  expect(result.mapkit_stable_id).toContain('37.');
});

it('returns null when no results found', async () => {
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results: [] }),
  });

  const result = await searchPlace('Nonexistent Place', 37.775, -122.419);
  expect(result).toBeNull();
});

it('returns null when fetch fails', async () => {
  fetch.mockResolvedValueOnce({ ok: false });
  const result = await searchPlace('Test', 37.775, -122.419);
  expect(result).toBeNull();
});
