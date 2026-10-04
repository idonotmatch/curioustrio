jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
}));
jest.mock('node-fetch');

const {
  searchPlace,
  searchPlaces,
  autocompletePlaces,
  completePlaceSuggestion,
  MapkitSearchUnavailableError,
  resetMapkitCachesForTest,
} = require('../../src/services/mapkitService');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

function mockAccessToken() {
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ accessToken: 'mock-access-token', expiresInSeconds: 1800 }),
  });
}

beforeEach(() => {
  process.env.APPLE_MAPS_KEY_ID = 'test-key-id';
  process.env.APPLE_MAPS_TEAM_ID = 'test-team-id';
  process.env.APPLE_MAPS_PRIVATE_KEY = 'fake-key';
  fetch.mockReset();
  jwt.sign.mockClear();
  resetMapkitCachesForTest();
});

it('returns top place result from MapKit search', async () => {
  mockAccessToken();
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
  expect(jwt.sign).toHaveBeenCalledWith(
    expect.objectContaining({ scope: 'server_api' }),
    '-----BEGIN PRIVATE KEY-----\nfake-key\n-----END PRIVATE KEY-----',
    expect.objectContaining({ algorithm: 'ES256', keyid: 'test-key-id', header: { typ: 'JWT' } })
  );
});

it('returns multiple place results from MapKit search', async () => {
  mockAccessToken();
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      results: [
        {
          displayLines: ["Trader Joe's", '123 Main St, San Francisco, CA'],
          coordinate: { latitude: 37.7749, longitude: -122.4194 },
        },
        {
          displayLines: ['Target', '789 Broadway, New York, NY'],
          coordinate: { latitude: 40.7306, longitude: -73.9352 },
        },
      ],
    }),
  });

  const results = await searchPlaces('store', 37.775, -122.419);
  expect(results).toHaveLength(2);
  expect(results[0].place_name).toBe("Trader Joe's");
  expect(results[1].place_name).toBe('Target');
});

it('returns null when no results found', async () => {
  mockAccessToken();
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

  const result = await searchPlace('Nonexistent Place', 37.775, -122.419);
  expect(result).toBeNull();
});

it('returns null when fetch fails', async () => {
  mockAccessToken();
  fetch
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: false });
  await expect(searchPlace('Test', 37.775, -122.419)).rejects.toBeInstanceOf(MapkitSearchUnavailableError);
});

it('falls back to broader search when local POI search misses', async () => {
  mockAccessToken();
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          displayLines: ['Target', '789 Broadway, New York, NY'],
          coordinate: { latitude: 40.7306, longitude: -73.9352 },
        }],
      }),
    });

  const result = await searchPlace('Target', 37.775, -122.419);
  expect(result).not.toBeNull();
  expect(result.place_name).toBe('Target');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('throws an unavailable error when Apple Maps credentials are missing', async () => {
  delete process.env.APPLE_MAPS_KEY_ID;
  delete process.env.APPLE_MAPS_TEAM_ID;
  delete process.env.APPLE_MAPS_PRIVATE_KEY;

  await expect(searchPlace('Credentials Missing Place', 37.775, -122.419)).rejects.toBeInstanceOf(MapkitSearchUnavailableError);
});

it('throws an unavailable error when Apple Maps rejects authorization', async () => {
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'Not Authorized' } }),
  });

  await expect(searchPlace('Authorization Failure Place', 37.775, -122.419))
    .rejects.toMatchObject({
      name: 'MapkitSearchUnavailableError',
      message: 'Apple Maps authorization rejected',
      details: 'HTTP 401',
    });
});

it('returns Apple Maps autocomplete suggestions', async () => {
  mockAccessToken();
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      results: [{
        completionUrl: '/v1/search?q=Trader%20Joes&metadata=opaque',
        displayLines: ["Trader Joe's", '1133 Metropolitan Ave, Charlotte, NC'],
        location: { latitude: 35.208, longitude: -80.837 },
      }],
    }),
  });

  const results = await autocompletePlaces('trad', 35.2271, -80.8431, 5000, 5);
  expect(results).toEqual([expect.objectContaining({
    place_name: "Trader Joe's",
    address: '1133 Metropolitan Ave, Charlotte, NC',
    completion_url: '/v1/search?q=Trader%20Joes&metadata=opaque',
    search_strategy: 'autocomplete',
  })]);
  expect(fetch.mock.calls[1][0]).toContain('/v1/searchAutocomplete?');
});

it('resolves an Apple Maps autocomplete completion URL', async () => {
  mockAccessToken();
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      results: [{
        name: "Trader Joe's",
        formattedAddressLines: ['1133 Metropolitan Ave', 'Charlotte, NC 28204'],
        coordinate: { latitude: 35.208, longitude: -80.837 },
        id: 'apple-place-1',
      }],
    }),
  });

  const results = await completePlaceSuggestion('/v1/search?q=Trader%20Joes&metadata=opaque', 35.2271, -80.8431);
  expect(results[0]).toEqual(expect.objectContaining({
    place_name: "Trader Joe's",
    provider_place_id: 'apple-place-1',
    search_strategy: 'autocomplete_completion',
  }));
});

it('rejects completion URLs outside Apple Maps search', async () => {
  await expect(completePlaceSuggestion('https://example.com/v1/search?q=Target'))
    .rejects.toMatchObject({ name: 'MapkitSearchUnavailableError' });
  expect(fetch).not.toHaveBeenCalled();
});
