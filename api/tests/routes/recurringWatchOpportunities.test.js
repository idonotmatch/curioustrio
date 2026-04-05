const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|watch-opportunities-user';
    next();
  },
}));

jest.mock('../../src/models/user', () => ({
  findByProviderUid: jest.fn(),
}));

jest.mock('../../src/services/priceObservationService', () => ({
  findObservationOpportunities: jest.fn(),
}));

const User = require('../../src/models/user');
const { findObservationOpportunities } = require('../../src/services/priceObservationService');
const app = require('../../src/index');

beforeEach(() => {
  User.findByProviderUid.mockReset();
  findObservationOpportunities.mockReset();
});

describe('GET /recurring/watch-opportunities', () => {
  it('returns observation opportunities for household users', async () => {
    User.findByProviderUid.mockResolvedValueOnce({
      id: 'user-1',
      household_id: 'household-1',
    });
    findObservationOpportunities.mockResolvedValueOnce([{
      signal: 'buy_soon_better_price',
      item_name: 'Pampers Pure',
      merchant: 'Target',
      discount_percent: 7.2,
    }]);

    const res = await request(app)
      .get('/recurring/watch-opportunities')
      .query({ window_days: 5, freshness_hours: 72 });

    expect(res.status).toBe(200);
    expect(findObservationOpportunities).toHaveBeenCalledWith('household-1', {
      windowDays: 5,
      freshnessHours: 72,
    });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].signal).toBe('buy_soon_better_price');
  });

  it('returns 403 when the user is not in a household', async () => {
    User.findByProviderUid.mockResolvedValueOnce({
      id: 'user-1',
      household_id: null,
    });

    const res = await request(app).get('/recurring/watch-opportunities');
    expect(res.status).toBe(403);
  });
});
