const db = require('../../src/db');
const { detectRecurring } = require('../../src/services/recurringDetector');

let testHouseholdId;
let testUserId;

beforeAll(async () => {
  const hResult = await db.query(
    `INSERT INTO households (name) VALUES ('Detector Test Household') RETURNING id`
  );
  testHouseholdId = hResult.rows[0].id;

  const uResult = await db.query(
    `INSERT INTO users (provider_uid, name, email, household_id)
     VALUES ('auth0|detector-test-user', 'Detector Test User', 'detectortest@test.com', $1)
     ON CONFLICT (provider_uid) DO UPDATE SET household_id = $1
     RETURNING id`,
    [testHouseholdId]
  );
  testUserId = uResult.rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [testHouseholdId]);
  await db.query(`UPDATE users SET household_id = NULL WHERE id = $1`, [testUserId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await db.query(`DELETE FROM households WHERE id = $1`, [testHouseholdId]);
  await db.pool.end();
});

afterEach(async () => {
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [testHouseholdId]);
});

async function insertExpense(merchant, amount, date) {
  await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed')`,
    [testUserId, testHouseholdId, merchant, amount, date]
  );
}

describe('detectRecurring', () => {
  it('returns candidate for merchant with 3+ consistent monthly occurrences', async () => {
    // Seed 3 expenses ~30 days apart with the same amount (within 90 days)
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 60);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 30);
    const d3 = new Date(today);
    d3.setDate(d3.getDate() - 1);

    await insertExpense('Netflix', 15.99, d1.toISOString().split('T')[0]);
    await insertExpense('Netflix', 15.99, d2.toISOString().split('T')[0]);
    await insertExpense('Netflix', 15.99, d3.toISOString().split('T')[0]);

    const candidates = await detectRecurring(testHouseholdId);
    expect(candidates.length).toBe(1);
    expect(candidates[0].merchant).toBe('netflix');
    expect(candidates[0].frequency).toBe('monthly');
    expect(candidates[0].occurrenceCount).toBe(3);
    expect(candidates[0].medianAmount).toBe(15.99);
    expect(candidates[0].nextExpectedDate).toBeDefined();
  });

  it('does NOT return candidate with fewer than 3 occurrences', async () => {
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 30);

    await insertExpense('Spotify', 9.99, d1.toISOString().split('T')[0]);
    await insertExpense('Spotify', 9.99, today.toISOString().split('T')[0]);

    const candidates = await detectRecurring(testHouseholdId);
    const spotifyCandidates = candidates.filter(c => c.merchant === 'spotify');
    expect(spotifyCandidates.length).toBe(0);
  });

  it('does NOT return candidate with inconsistent gaps (>5 day variance from median)', async () => {
    const today = new Date();
    // Gaps: 10 days, 10 days, 60 days — inconsistent
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 80);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 70);
    const d3 = new Date(today);
    d3.setDate(d3.getDate() - 60);
    const d4 = new Date(today);
    d4.setDate(d4.getDate() - 1); // 59-day gap from d3

    await insertExpense('IrregularMerchant', 20.00, d1.toISOString().split('T')[0]);
    await insertExpense('IrregularMerchant', 20.00, d2.toISOString().split('T')[0]);
    await insertExpense('IrregularMerchant', 20.00, d3.toISOString().split('T')[0]);
    await insertExpense('IrregularMerchant', 20.00, d4.toISOString().split('T')[0]);

    const candidates = await detectRecurring(testHouseholdId);
    const found = candidates.filter(c => c.merchant === 'irregularmerchant');
    expect(found.length).toBe(0);
  });

  it('does NOT return candidate with inconsistent amounts (>10% variance)', async () => {
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 60);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 30);
    const d3 = new Date(today);
    d3.setDate(d3.getDate() - 1);

    // Amounts: 10.00, 10.00, 25.00 — 25.00 is 150% of 10.00, way over 10%
    await insertExpense('VariableAmount', 10.00, d1.toISOString().split('T')[0]);
    await insertExpense('VariableAmount', 10.00, d2.toISOString().split('T')[0]);
    await insertExpense('VariableAmount', 25.00, d3.toISOString().split('T')[0]);

    const candidates = await detectRecurring(testHouseholdId);
    const found = candidates.filter(c => c.merchant === 'variableamount');
    expect(found.length).toBe(0);
  });

  it('returns empty array for household with no expenses', async () => {
    const candidates = await detectRecurring(testHouseholdId);
    expect(candidates).toEqual([]);
  });
});
