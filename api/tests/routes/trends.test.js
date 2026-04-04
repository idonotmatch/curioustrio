const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'test|trends-user';
    next();
  },
}));

let userId;
let householdId;
let householdUserId;

beforeAll(async () => {
  const userResult = await db.query(
    `INSERT INTO users (provider_uid, name, budget_start_day)
     VALUES ('test|trends-user', 'Trend User', 1)
     ON CONFLICT (provider_uid) DO UPDATE SET budget_start_day = 1
     RETURNING id`
  );
  userId = userResult.rows[0].id;

  const hh = await db.query(
    `INSERT INTO households (name, budget_start_day) VALUES ('Trend HH', 1) RETURNING id`
  );
  householdId = hh.rows[0].id;

  const householdUser = await db.query(
    `INSERT INTO users (provider_uid, name, household_id, budget_start_day)
     VALUES ('test|trends-household-user', 'Trend HH User', $1, 1)
     RETURNING id`,
    [householdId]
  );
  householdUserId = householdUser.rows[0].id;
});

afterEach(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [userId, householdUserId]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2) OR household_id = $3`, [userId, householdUserId, householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE id = $1`, [userId]);
});

afterAll(async () => {
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [userId, householdUserId]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2) OR household_id = $3`, [userId, householdUserId, householdId]);
  await db.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, householdUserId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
});

describe('GET /trends/summary', () => {
  it('returns personal pace summary and budget adherence', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 500)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES
       ($1, 100, '2026-04-01', 'manual', 'confirmed'),
       ($1, 40, '2026-04-03', 'manual', 'confirmed'),
       ($1, 20, '2026-04-04', 'manual', 'confirmed'),
       ($1, 70, '2026-03-01', 'manual', 'confirmed'),
       ($1, 30, '2026-03-04', 'manual', 'confirmed'),
       ($1, 20, '2026-03-07', 'manual', 'confirmed'),
       ($1, 40, '2026-02-01', 'manual', 'confirmed'),
       ($1, 25, '2026-02-03', 'manual', 'confirmed'),
       ($1, 15, '2026-02-08', 'manual', 'confirmed'),
       ($1, 50, '2026-01-01', 'manual', 'confirmed'),
       ($1, 25, '2026-01-04', 'manual', 'confirmed'),
       ($1, 15, '2026-01-09', 'manual', 'confirmed'),
       ($1, 300, '2025-10-05', 'manual', 'confirmed'),
       ($1, 180, '2025-10-08', 'manual', 'confirmed'),
       ($1, 120, '2025-10-12', 'manual', 'confirmed'),
       ($1, 250, '2025-11-05', 'manual', 'confirmed'),
       ($1, 180, '2025-11-08', 'manual', 'confirmed'),
       ($1, 120, '2025-11-12', 'manual', 'confirmed'),
       ($1, 240, '2025-12-05', 'manual', 'confirmed'),
       ($1, 170, '2025-12-08', 'manual', 'confirmed'),
       ($1, 110, '2025-12-12', 'manual', 'confirmed'),
       ($1, 230, '2026-01-05', 'manual', 'confirmed'),
       ($1, 170, '2026-01-08', 'manual', 'confirmed'),
       ($1, 110, '2026-01-12', 'manual', 'confirmed'),
       ($1, 240, '2026-02-05', 'manual', 'confirmed'),
       ($1, 180, '2026-02-08', 'manual', 'confirmed'),
       ($1, 110, '2026-02-12', 'manual', 'confirmed'),
       ($1, 250, '2026-03-05', 'manual', 'confirmed'),
       ($1, 180, '2026-03-08', 'manual', 'confirmed'),
       ($1, 110, '2026-03-12', 'manual', 'confirmed')`,
      [userId]
    );

    const res = await request(app).get('/trends/summary?scope=personal&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('personal');
    expect(res.body.month).toBe('2026-04');
    expect(res.body.pace.current_spend_to_date).toBeGreaterThan(0);
    expect(res.body.pace.historical_period_count).toBe(3);
    expect(res.body.pace.historical_spend_to_date_avg).toBeGreaterThan(0);
    expect(res.body.budget_adherence.budget_limit).toBe(500);
    expect(res.body.budget_adherence.budget_fit).toBe('too_low');
  });

  it('returns household trend summary when user is in a household', async () => {
    await db.query(`UPDATE users SET household_id = $1 WHERE id = $2`, [householdId, userId]);
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit)
       VALUES ($1, NULL, 400), ($2, NULL, 300)`,
      [userId, householdUserId]
    );
    await db.query(
      `INSERT INTO expenses (user_id, household_id, amount, date, source, status)
       VALUES
       ($1, $3, 100, '2026-04-01', 'manual', 'confirmed'),
       ($2, $3, 50, '2026-04-03', 'manual', 'confirmed'),
       ($1, $3, 30, '2026-04-05', 'manual', 'confirmed'),
       ($1, $3, 50, '2026-03-01', 'manual', 'confirmed'),
       ($2, $3, 40, '2026-03-03', 'manual', 'confirmed'),
       ($1, $3, 35, '2026-03-06', 'manual', 'confirmed'),
       ($1, $3, 45, '2026-02-01', 'manual', 'confirmed'),
       ($2, $3, 35, '2026-02-03', 'manual', 'confirmed'),
       ($1, $3, 25, '2026-02-06', 'manual', 'confirmed'),
       ($1, $3, 40, '2026-01-01', 'manual', 'confirmed'),
       ($2, $3, 30, '2026-01-03', 'manual', 'confirmed'),
       ($1, $3, 20, '2026-01-06', 'manual', 'confirmed')`,
      [userId, householdUserId, householdId]
    );

    const res = await request(app).get('/trends/summary?scope=household&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('household');
    expect(res.body.pace.current_spend_to_date).toBeGreaterThan(0);
    expect(res.body.pace.historical_period_count).toBe(3);
    expect(res.body.budget_adherence.budget_limit).toBe(700);
  });

  it('ignores sparse prior months when deciding whether trend history exists', async () => {
    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES
       ($1, 120, '2026-04-01', 'manual', 'confirmed'),
       ($1, 75, '2026-03-01', 'manual', 'confirmed')`,
      [userId]
    );

    const res = await request(app).get('/trends/summary?scope=personal&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.pace.historical_period_count).toBe(0);
    expect(res.body.pace.historical_spend_to_date_avg).toBeNull();
    expect(res.body.budget_adherence.historical_period_count).toBe(0);
  });

  it('does not fabricate historical trend windows before the user started logging data', async () => {
    const res = await request(app).get('/trends/summary?scope=personal&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.pace.historical_period_count).toBe(0);
    expect(res.body.pace.historical_spend_to_date_avg).toBeNull();
    expect(res.body.budget_adherence.historical_period_count).toBe(0);
    expect(res.body.budget_adherence.budget_fit).toBeNull();
  });
});
