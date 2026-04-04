const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-recurring-user';
    next();
  },
}));

let householdId;
let categoryId;
let userId;

beforeAll(async () => {
  const hhResult = await db.query(
    `INSERT INTO households (name) VALUES ('Recurring Route Test Household') RETURNING id`
  );
  householdId = hhResult.rows[0].id;

  const catResult = await db.query(
    `INSERT INTO categories (name, household_id) VALUES ('Test Category', $1) RETURNING id`,
    [householdId]
  );
  categoryId = catResult.rows[0].id;

  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|test-recurring-user', 'Recurring User', 'recurring@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = userResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-recurring-user'`);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

afterEach(async () => {
  await db.query(`DELETE FROM recurring_expenses WHERE household_id = $1`, [householdId]);
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
});

describe('GET /recurring', () => {
  it('returns [] when no recurring expenses', async () => {
    const res = await request(app).get('/recurring');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /recurring', () => {
  it('creates a recurring expense (201)', async () => {
    const res = await request(app)
      .post('/recurring')
      .send({
        merchant: 'Netflix',
        expected_amount: 15.99,
        category_id: categoryId,
        frequency: 'monthly',
        next_expected_date: '2026-04-01',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.merchant).toBe('Netflix');
    expect(parseFloat(res.body.expected_amount)).toBe(15.99);
    expect(res.body.frequency).toBe('monthly');
    expect(res.body.household_id).toBe(householdId);
  });

  it('returns 400 on missing fields', async () => {
    const res = await request(app)
      .post('/recurring')
      .send({ merchant: 'Netflix' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

describe('DELETE /recurring/:id', () => {
  it('removes and returns the deleted row', async () => {
    // Create one first
    const createRes = await request(app)
      .post('/recurring')
      .send({
        merchant: 'Hulu',
        expected_amount: 12.99,
        category_id: categoryId,
        frequency: 'monthly',
        next_expected_date: '2026-04-15',
      });

    const id = createRes.body.id;

    const res = await request(app).delete(`/recurring/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.merchant).toBe('Hulu');
  });

  it('returns 404 when not found', async () => {
    const res = await request(app).delete('/recurring/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe('POST /recurring/detect', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /recurring/detect-items', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect-items');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /recurring/detect-item-signals', () => {
  it('returns array (may be empty)', async () => {
    const res = await request(app).post('/recurring/detect-item-signals');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /recurring (no household)', () => {
  it('returns 403 when user has no household_id', async () => {
    await db.query(
      `UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-recurring-user'`
    );

    const res = await request(app).get('/recurring');

    await db.query(
      `UPDATE users SET household_id = $1 WHERE provider_uid = 'auth0|test-recurring-user'`,
      [householdId]
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/household/i);
  });
});
