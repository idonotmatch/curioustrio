const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|efficient-reads-user';
    next();
  },
}));

const app = require('../../src/index');
const db = require('../../src/db');

let householdId;
let userId;

beforeAll(async () => {
  const household = await db.query(
    `INSERT INTO households (name) VALUES ('Efficient Reads') RETURNING id`
  );
  householdId = household.rows[0].id;
  const user = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id, budget_start_day)
     VALUES ('auth0|efficient-reads-user', 'Efficient Reader', 'reads@test.local', $1, 1)
     RETURNING id`,
    [householdId]
  );
  userId = user.rows[0].id;
  await db.query(
    `INSERT INTO budget_settings (user_id, category_id, monthly_limit)
     VALUES ($1, NULL, 500)`,
    [userId]
  );
  const values = [];
  const placeholders = [];
  for (let index = 0; index < 30; index += 1) {
    const offset = index * 6;
    values.push(userId, householdId, `Merchant ${index}`, index + 1, '2026-10-02', new Date(Date.UTC(2026, 9, 2, 12, 0, index)));
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, 'manual', 'confirmed', $${offset + 6})`);
  }
  await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status, created_at)
     VALUES ${placeholders.join(', ')}`,
    values
  );
});

afterAll(async () => {
  await db.query('DELETE FROM user_summary_snapshots WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM expenses WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM budget_settings WHERE user_id = $1', [userId]);
  await db.query('UPDATE users SET household_id = NULL WHERE id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await db.query('DELETE FROM households WHERE id = $1', [householdId]);
});

describe('efficient read routes', () => {
  it('builds then reuses a compact summary projection', async () => {
    const first = await request(app).get('/summary?period=2026-10&start_day=1');
    expect(first.status).toBe(200);
    expect(first.headers['x-adlo-summary-source']).toBe('live');
    expect(first.body.personal_budget.total).toMatchObject({ limit: 500, spent: 465, remaining: 35 });
    expect(first.body.expenses).toHaveLength(12);

    const second = await request(app).get('/summary?period=2026-10&start_day=1');
    expect(second.status).toBe(200);
    expect(second.headers['x-adlo-summary-source']).toBe('projection');
    expect(second.body).toEqual(first.body);
  });

  it('returns stable, non-overlapping cursor pages without changing the legacy shape', async () => {
    const first = await request(app).get('/expenses?month=2026-10&paginated=1&limit=10');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(10);
    expect(first.body.next_cursor).toBeTruthy();

    const second = await request(app)
      .get(`/expenses?month=2026-10&paginated=1&limit=10&cursor=${encodeURIComponent(first.body.next_cursor)}`);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(10);
    const firstIds = new Set(first.body.items.map((expense) => expense.id));
    expect(second.body.items.every((expense) => !firstIds.has(expense.id))).toBe(true);

    const legacy = await request(app).get('/expenses?month=2026-10');
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body)).toBe(true);
  });
});
