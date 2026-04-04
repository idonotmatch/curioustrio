const request = require('supertest');
const app = require('../../src/index');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = 'auth0|test-user-123'; next(); },
}));
jest.mock('../../src/services/mapkitService');
const { searchPlace } = require('../../src/services/mapkitService');

describe('GET /places/search', () => {
  it('returns place result for valid query', async () => {
    searchPlace.mockResolvedValueOnce({
      place_name: "Trader Joe's",
      address: '123 Main St, SF, CA',
      mapkit_stable_id: '37.7749,-122.4194',
    });

    const res = await request(app)
      .get('/places/search')
      .query({ q: "Trader Joe's", lat: '37.775', lng: '-122.419' });

    expect(res.status).toBe(200);
    expect(res.body.result.place_name).toBe("Trader Joe's");
  });

  it('returns result: null when no place found', async () => {
    searchPlace.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Nowhere', lat: '37.775', lng: '-122.419' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBeNull();
  });

  it('supports search without coordinates', async () => {
    searchPlace.mockResolvedValueOnce({
      place_name: 'Target',
      address: '456 Market St, SF, CA',
      mapkit_stable_id: '37.7840,-122.4075',
    });

    const res = await request(app)
      .get('/places/search')
      .query({ q: 'Target' });

    expect(res.status).toBe(200);
    expect(searchPlace).toHaveBeenCalledWith('Target', null, null, 500);
    expect(res.body.result.place_name).toBe('Target');
  });

  it('returns 400 when query params are missing', async () => {
    const res = await request(app).get('/places/search');
    expect(res.status).toBe(400);
  });
});
