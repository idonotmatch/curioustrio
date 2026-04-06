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
  await db.query(
    `CREATE TABLE IF NOT EXISTS scenario_memory (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       household_id UUID REFERENCES households(id) ON DELETE SET NULL,
       scope TEXT NOT NULL CHECK (scope IN ('personal', 'household')),
       label TEXT NOT NULL,
       amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
       month TEXT NOT NULL,
       memory_state TEXT NOT NULL DEFAULT 'ephemeral'
         CHECK (memory_state IN ('ephemeral', 'considering', 'suppressed')),
       intent_signal TEXT
         CHECK (intent_signal IN ('considering', 'not_right_now', 'just_exploring')),
       last_affordability_status TEXT,
       last_can_absorb BOOLEAN,
       last_projected_headroom_amount NUMERIC(12,2),
       last_risk_adjusted_headroom_amount NUMERIC(12,2),
       last_recurring_pressure_amount NUMERIC(12,2),
       last_material_change TEXT
         CHECK (last_material_change IN ('improved', 'worsened', 'unchanged')),
       watch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
       watch_started_at TIMESTAMPTZ,
       previous_affordability_status TEXT,
       previous_risk_adjusted_headroom_amount NUMERIC(12,2),
       last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_resurfaced_at TIMESTAMPTZ,
       expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
  await db.query(
    `ALTER TABLE scenario_memory
       ADD COLUMN IF NOT EXISTS last_material_change TEXT,
       ADD COLUMN IF NOT EXISTS watch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS watch_started_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS previous_affordability_status TEXT,
       ADD COLUMN IF NOT EXISTS previous_risk_adjusted_headroom_amount NUMERIC(12,2)`
  );

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
     ON CONFLICT (provider_uid) DO UPDATE
       SET name = EXCLUDED.name,
           household_id = EXCLUDED.household_id,
           budget_start_day = EXCLUDED.budget_start_day
     RETURNING id`,
    [householdId]
  );
  householdUserId = householdUser.rows[0].id;
});

afterEach(async () => {
  await db.query(`DELETE FROM scenario_memory WHERE user_id IN ($1, $2)`, [userId, householdUserId]);
  await db.query(`DELETE FROM budget_settings WHERE user_id IN ($1, $2)`, [userId, householdUserId]);
  await db.query(`DELETE FROM expenses WHERE user_id IN ($1, $2) OR household_id = $3`, [userId, householdUserId, householdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE id = $1`, [userId]);
});

afterAll(async () => {
  await db.query(`DELETE FROM scenario_memory WHERE user_id IN ($1, $2)`, [userId, householdUserId]);
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
    expect(res.body.projection).toBeTruthy();
    expect(res.body.projection.scope).toBe('personal');
    expect(res.body.projection.overall.historical_period_count).toBeGreaterThanOrEqual(3);
    expect(res.body.projection.overall.adjusted_projected_total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.projection.categories)).toBe(true);
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
    expect(res.body.projection.scope).toBe('household');
    expect(res.body.projection.overall.adjusted_projected_total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.projection.categories)).toBe(true);
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
    expect(res.body.projection.overall.historical_period_count).toBe(0);
    expect(res.body.projection.overall.adjusted_projected_total).toBeNull();
  });

  it('does not fabricate historical trend windows before the user started logging data', async () => {
    const res = await request(app).get('/trends/summary?scope=personal&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.pace.historical_period_count).toBe(0);
    expect(res.body.pace.historical_spend_to_date_avg).toBeNull();
    expect(res.body.budget_adherence.historical_period_count).toBe(0);
    expect(res.body.budget_adherence.budget_fit).toBeNull();
    expect(res.body.projection.overall.historical_period_count).toBe(0);
    expect(res.body.projection.overall.adjusted_projected_total).toBeNull();
  });

  it('splits unusual spend out of the baseline projection', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 600)`,
      [userId]
    );

    await db.query(
      `INSERT INTO categories (id, household_id, name)
       VALUES
       ('11111111-1111-1111-1111-111111111111', NULL, 'Groceries'),
       ('22222222-2222-2222-2222-222222222222', NULL, 'Travel')
       ON CONFLICT (id) DO NOTHING`
    );

    await db.query(
      `INSERT INTO expenses (user_id, merchant, amount, date, source, status, category_id)
       VALUES
       ($1, 'Grocer', 50, '2026-04-01', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Airline', 300, '2026-04-02', 'manual', 'confirmed', '22222222-2222-2222-2222-222222222222'),
       ($1, 'Grocer', 30, '2026-03-01', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Grocer', 35, '2026-03-04', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Cafe', 30, '2026-03-02', 'manual', 'confirmed', NULL),
       ($1, 'Gas', 40, '2026-03-03', 'manual', 'confirmed', NULL),
       ($1, 'Grocer', 20, '2026-02-01', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Grocer', 25, '2026-02-04', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Cafe', 30, '2026-02-02', 'manual', 'confirmed', NULL),
       ($1, 'Gas', 50, '2026-02-03', 'manual', 'confirmed', NULL),
       ($1, 'Grocer', 10, '2026-01-01', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Grocer', 20, '2026-01-04', 'manual', 'confirmed', '11111111-1111-1111-1111-111111111111'),
       ($1, 'Cafe', 30, '2026-01-02', 'manual', 'confirmed', NULL),
       ($1, 'Gas', 60, '2026-01-03', 'manual', 'confirmed', NULL)`,
      [userId]
    );

    const res = await request(app).get('/trends/summary?scope=personal&month=2026-04');
    expect(res.status).toBe(200);
    expect(res.body.projection.overall.normal_spend_to_date).toBe(50);
    expect(res.body.projection.overall.unusual_spend_to_date).toBe(300);
    expect(res.body.projection.overall.adjusted_projected_total).toBeGreaterThan(
      res.body.projection.overall.baseline_projected_total
    );
    expect(res.body.projection.overall.top_unusual_expenses[0].merchant).toBe('Airline');
    expect(res.body.projection.categories[0].category_key).toBeTruthy();
    expect(res.body.projection.categories[0].adjusted_projected_total).toBeGreaterThan(0);
  });
});

describe('POST /trends/scenario-check', () => {
  it('evaluates whether a one-off purchase can be absorbed', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 700)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES
       ($1, 40, '2026-04-01', 'manual', 'confirmed'),
       ($1, 20, '2026-04-02', 'manual', 'confirmed'),
       ($1, 60, '2026-03-01', 'manual', 'confirmed'),
       ($1, 40, '2026-03-03', 'manual', 'confirmed'),
       ($1, 30, '2026-03-05', 'manual', 'confirmed'),
       ($1, 55, '2026-02-01', 'manual', 'confirmed'),
       ($1, 35, '2026-02-03', 'manual', 'confirmed'),
       ($1, 25, '2026-02-05', 'manual', 'confirmed'),
       ($1, 50, '2026-01-01', 'manual', 'confirmed'),
       ($1, 30, '2026-01-03', 'manual', 'confirmed'),
       ($1, 20, '2026-01-05', 'manual', 'confirmed')`,
      [userId]
    );

    const res = await request(app)
      .post('/trends/scenario-check')
      .send({
        scope: 'personal',
        month: '2026-04',
        proposed_amount: 75,
        label: 'Standing desk',
      });

    expect(res.status).toBe(200);
    expect(res.body.scenario).toBeTruthy();
    expect(res.body.scenario.label).toBe('Standing desk');
    expect(res.body.scenario.proposed_amount).toBe(75);
    expect(typeof res.body.scenario.can_absorb).toBe('boolean');
    expect(res.body.scenario_memory).toBeTruthy();
    expect(res.body.scenario_memory.memory_state).toBe('ephemeral');
    expect(res.body.scenario_memory.intent_signal).toBeNull();
  });

  it('returns 400 for invalid proposed amounts', async () => {
    const res = await request(app)
      .post('/trends/scenario-check')
      .send({
        scope: 'personal',
        proposed_amount: 0,
      });

    expect(res.status).toBe(400);
  });

  it('records user intent for a scenario memory', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 700)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES
       ($1, 40, '2026-04-01', 'manual', 'confirmed'),
       ($1, 20, '2026-04-02', 'manual', 'confirmed'),
       ($1, 60, '2026-03-01', 'manual', 'confirmed'),
       ($1, 40, '2026-03-03', 'manual', 'confirmed'),
       ($1, 30, '2026-03-05', 'manual', 'confirmed'),
       ($1, 55, '2026-02-01', 'manual', 'confirmed'),
       ($1, 35, '2026-02-03', 'manual', 'confirmed'),
       ($1, 25, '2026-02-05', 'manual', 'confirmed'),
       ($1, 50, '2026-01-01', 'manual', 'confirmed'),
       ($1, 30, '2026-01-03', 'manual', 'confirmed'),
       ($1, 20, '2026-01-05', 'manual', 'confirmed')`,
      [userId]
    );

    const createRes = await request(app)
      .post('/trends/scenario-check')
      .send({
        scope: 'personal',
        month: '2026-04',
        proposed_amount: 75,
        label: 'Standing desk',
      });

    expect(createRes.status).toBe(200);

    const intentRes = await request(app)
      .post(`/trends/scenario-memory/${createRes.body.scenario_memory.id}/intent`)
      .send({ intent_signal: 'considering' });

    expect(intentRes.status).toBe(200);
    expect(intentRes.body.scenario_memory.intent_signal).toBe('considering');
    expect(intentRes.body.scenario_memory.memory_state).toBe('considering');
  });

  it('enables watching for a scenario memory', async () => {
    const inserted = await db.query(
      `INSERT INTO scenario_memory (
         user_id,
         scope,
         label,
         amount,
         month,
         memory_state,
         intent_signal,
         last_affordability_status,
         last_can_absorb,
         last_evaluated_at,
         expires_at
       )
       VALUES (
         $1, 'personal', 'Desk lamp', 80, '2026-04',
         'considering', 'considering', 'absorbable', TRUE, NOW(), NOW() + INTERVAL '7 days'
       )
       RETURNING id`,
      [userId]
    );

    const res = await request(app)
      .post(`/trends/scenario-memory/${inserted.rows[0].id}/watch`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.scenario_memory.watch_enabled).toBe(true);
    expect(res.body.scenario_memory.memory_state).toBe('considering');
    expect(res.body.scenario_memory.watch_started_at).toBeTruthy();
  });

  it('lists recent active scenario memories for the user', async () => {
    await db.query(
      `INSERT INTO scenario_memory (
         user_id,
         household_id,
         scope,
         label,
         amount,
         month,
         memory_state,
         intent_signal,
         last_affordability_status,
         last_can_absorb,
         last_evaluated_at,
         expires_at
       )
       VALUES
       ($1, NULL, 'personal', 'Running shoes', 180, '2026-04', 'ephemeral', NULL, 'tight', true, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '5 days'),
       ($1, NULL, 'personal', 'Air fryer', 240, '2026-04', 'considering', 'considering', 'risky', false, NOW() - INTERVAL '2 hours', NOW() + INTERVAL '10 days'),
       ($1, NULL, 'personal', 'Patio set', 500, '2026-04', 'suppressed', 'not_right_now', 'not_absorbable', false, NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '2 days')`,
      [userId]
    );

    const res = await request(app).get('/trends/scenario-memory/recent?limit=5');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((item) => item.label)).toEqual(expect.arrayContaining(['Running shoes', 'Air fryer']));
    expect(res.body.items.find((item) => item.label === 'Patio set')).toBeUndefined();
  });

  it('passively refreshes considering plans when loading recent memories', async () => {
    await db.query(
      `INSERT INTO budget_settings (user_id, category_id, monthly_limit) VALUES ($1, NULL, 700)`,
      [userId]
    );

    await db.query(
      `INSERT INTO expenses (user_id, amount, date, source, status)
       VALUES
       ($1, 40, '2026-04-01', 'manual', 'confirmed'),
       ($1, 20, '2026-04-02', 'manual', 'confirmed'),
       ($1, 60, '2026-03-01', 'manual', 'confirmed'),
       ($1, 40, '2026-03-03', 'manual', 'confirmed'),
       ($1, 30, '2026-03-05', 'manual', 'confirmed'),
       ($1, 55, '2026-02-01', 'manual', 'confirmed'),
       ($1, 35, '2026-02-03', 'manual', 'confirmed'),
       ($1, 25, '2026-02-05', 'manual', 'confirmed'),
       ($1, 50, '2026-01-01', 'manual', 'confirmed'),
       ($1, 30, '2026-01-03', 'manual', 'confirmed'),
       ($1, 20, '2026-01-05', 'manual', 'confirmed')`,
      [userId]
    );

    await db.query(
      `INSERT INTO scenario_memory (
         user_id,
         household_id,
         scope,
         label,
         amount,
         month,
         memory_state,
         intent_signal,
         last_affordability_status,
         last_can_absorb,
         last_risk_adjusted_headroom_amount,
         last_evaluated_at,
         expires_at
       )
       VALUES
       ($1, NULL, 'personal', 'Standing desk', 75, '2026-04', 'considering', 'considering', 'tight', true, 10, NOW() - INTERVAL '2 days', NOW() + INTERVAL '10 days')`,
      [userId]
    );

    const res = await request(app).get('/trends/scenario-memory/recent?limit=5');

    expect(res.status).toBe(200);
    const refreshed = res.body.items.find((item) => item.label === 'Standing desk');
    expect(refreshed).toBeTruthy();
    expect(refreshed.last_evaluated_at).toBeTruthy();
    expect(['improved', 'worsened', 'unchanged']).toContain(refreshed.last_material_change);
  });

  it('lists watched scenario memories for the user', async () => {
    await db.query(
      `INSERT INTO scenario_memory (
         user_id,
         household_id,
         scope,
         label,
         amount,
         month,
         memory_state,
         intent_signal,
         watch_enabled,
         watch_started_at,
         last_affordability_status,
         last_can_absorb,
         last_evaluated_at,
         expires_at
       )
       VALUES
       ($1, NULL, 'personal', 'Running shoes', 180, '2026-04', 'considering', 'considering', TRUE, NOW(), 'absorbable', true, NOW(), NOW() + INTERVAL '14 days'),
       ($1, NULL, 'household', 'Air fryer', 240, '2026-04', 'considering', 'considering', TRUE, NOW(), 'tight', false, NOW() - INTERVAL '1 day', NOW() + INTERVAL '14 days')`,
      [userId]
    );

    const res = await request(app).get('/trends/scenario-memory/watching?limit=10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((item) => item.watch_enabled)).toBe(true);
  });
});
