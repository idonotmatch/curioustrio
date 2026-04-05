const request = require('supertest');
const app = require('../../src/index');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'auth0|test-user-123'; next(); },
}));
jest.mock('../../src/services/mapkitService');
const { searchPlaces } = require('../../src/services/mapkitService');

describe('GET /places/search', () => {
  it('returns place result for valid query', async () => {
    searchPlaces.mockResolvedValueOnce([{
      place_name: "Trader Joe's",
      address: '123 Main St, SF, CA',
      mapkit_stable_id: '37.7749,-122.4194',
    }]);

    const res = await request(app)
      .get('/places/search')
      .query({ q: "Trader Joe's", lat: '37.775', lng: '-122.419' });

    expect(res.status).toBe(200);
    expect(res.body.result.place_name).toBe("Trader Joe's");
    expect(res.body.results).toHaveLength(1);
  });

  it('returns result: null when no place found', async () => {
    searchPlaces.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Nowhere', lat: '37.775', lng: '-122.419' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBeNull();
    expect(res.body.results).toEqual([]);
  });

  it('returns 503 when place search is unavailable', async () => {
    const err = new Error('Place search unavailable');
    err.name = 'MapkitSearchUnavailableError';
    searchPlaces.mockRejectedValueOnce(err);
    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Target', lat: '37.775', lng: '-122.419' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Place search temporarily unavailable');
  });

  it('supports search without coordinates', async () => {
    searchPlaces.mockResolvedValueOnce([{
      place_name: 'Target',
      address: '456 Market St, SF, CA',
      mapkit_stable_id: '37.7840,-122.4075',
    }]);

    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Target' });

    expect(res.status).toBe(200);
    expect(searchPlaces).toHaveBeenCalledWith('Target', null, null, 500);
    expect(res.body.result.place_name).toBe('Target');
  });

  it('returns 400 when query params are missing', async () => {
    const res = await request(app).get('/places/search');
    expect(res.status).toBe(400);
  });
});
