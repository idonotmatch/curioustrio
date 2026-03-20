const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));
jest.mock('../../src/services/nlParser');
jest.mock('../../src/services/categoryAssigner');

const { parseExpense } = require('../../src/services/nlParser');
const { assignCategory } = require('../../src/services/categoryAssigner');

beforeAll(async () => {
  await db.query(
    `INSERT INTO users (auth0_id, name, email) VALUES ('auth0|test-user-123', 'Test User', 'test@test.com')
     ON CONFLICT (auth0_id) DO NOTHING`
  );
});

afterAll(() => db.pool.end());

describe('POST /expenses/parse', () => {
  it('returns parsed expense with category suggestion', async () => {
    parseExpense.mockResolvedValueOnce({
      merchant: "Trader Joe's", amount: 84.17, date: '2026-03-20', notes: null,
    });
    assignCategory.mockResolvedValueOnce({
      category_id: 'some-cat-id', source: 'memory', confidence: 4,
    });

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: '84.17 trader joes', today: '2026-03-20' });

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBe("Trader Joe's");
    expect(res.body.amount).toBe(84.17);
    expect(res.body.category_id).toBe('some-cat-id');
  });

  it('returns 422 when input cannot be parsed', async () => {
    parseExpense.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/expenses/parse')
      .send({ input: 'asdfjkl', today: '2026-03-20' });

    expect(res.status).toBe(422);
  });
});

describe('POST /expenses/confirm', () => {
  it('creates a confirmed expense and updates merchant mapping', async () => {
    const res = await request(app)
      .post('/expenses/confirm')
      .send({
        merchant: "Trader Joe's",
        amount: 84.17,
        date: '2026-03-20',
        source: 'manual',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
  });
});

describe('GET /expenses', () => {
  it('returns expenses for the authenticated user', async () => {
    const res = await request(app).get('/expenses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
