const db = require('../../src/db');
const Expense = require('../../src/models/expense');
const DuplicateFlag = require('../../src/models/duplicateFlag');
const detectDuplicates = require('../../src/services/duplicateDetector');

let householdId;
let householdId2;
let userId;
let userId2;

beforeAll(async () => {
  // Create two households
  const h1 = await db.query(`INSERT INTO households (name) VALUES ('DupDet Household A') RETURNING id`);
  householdId = h1.rows[0].id;

  const h2 = await db.query(`INSERT INTO households (name) VALUES ('DupDet Household B') RETURNING id`);
  householdId2 = h2.rows[0].id;

  // Create two users
  const u1 = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|dupdet-user1', 'DupDet User1', 'dupdet1@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId]
  );
  userId = u1.rows[0].id;

  const u2 = await db.query(
    `INSERT INTO users (auth0_id, name, email, household_id)
     VALUES ('auth0|dupdet-user2', 'DupDet User2', 'dupdet2@test.com', $1)
     ON CONFLICT (auth0_id) DO UPDATE SET household_id = $1
     RETURNING id`,
    [householdId2]
  );
  userId2 = u2.rows[0].id;
});

afterAll(async () => {
  // Delete in FK-safe order
  await db.query(`DELETE FROM duplicate_flags WHERE expense_id_a IN (SELECT id FROM expenses WHERE household_id IN ($1, $2)) OR expense_id_b IN (SELECT id FROM expenses WHERE household_id IN ($1, $2))`, [householdId, householdId2]);
  await db.query(`DELETE FROM expenses WHERE household_id IN ($1, $2)`, [householdId, householdId2]);
  await db.query(`DELETE FROM household_invites WHERE household_id IN ($1, $2)`, [householdId, householdId2]);
  await db.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, userId2]);
  await db.query(`DELETE FROM households WHERE id IN ($1, $2)`, [householdId, householdId2]);
  await db.pool.end();
});

describe('detectDuplicates', () => {
  it('returns [] when no householdId', async () => {
    const expense = {
      id: '00000000-0000-0000-0000-000000000001',
      householdId: null,
      merchant: 'Starbucks',
      amount: '5.00',
      date: '2026-03-01',
      mapkit_stable_id: null,
    };

    const flags = await detectDuplicates(expense);

    expect(flags).toEqual([]);
  });

  it('returns [] when no duplicates exist', async () => {
    const expense = await Expense.create({
      userId,
      householdId,
      merchant: 'UniqueMerchant123',
      amount: '42.00',
      date: '2026-01-15',
      source: 'manual',
    });

    const flags = await detectDuplicates({
      id: expense.id,
      householdId: expense.household_id,
      merchant: expense.merchant,
      amount: expense.amount,
      date: '2026-01-15',
      mapkit_stable_id: null,
    });

    expect(flags).toEqual([]);
  });

  it('detects exact match (same merchant, amount, date, same household) → confidence=exact', async () => {
    // Seed existing expense
    const existing = await Expense.create({
      userId,
      householdId,
      merchant: 'Whole Foods',
      amount: '78.50',
      date: '2026-02-10',
      source: 'camera',
      status: 'confirmed',
    });

    // New expense that is an exact match
    const newExpense = await Expense.create({
      userId,
      householdId,
      merchant: 'Whole Foods',
      amount: '78.50',
      date: '2026-02-10',
      source: 'manual',
    });

    const flags = await detectDuplicates({
      id: newExpense.id,
      householdId: newExpense.household_id,
      merchant: newExpense.merchant,
      amount: newExpense.amount,
      date: '2026-02-10',
      mapkit_stable_id: null,
    });

    expect(flags.length).toBeGreaterThanOrEqual(1);
    const flag = flags.find(f =>
      (f.expense_id_a === newExpense.id && f.expense_id_b === existing.id) ||
      (f.expense_id_a === existing.id && f.expense_id_b === newExpense.id)
    );
    expect(flag).toBeDefined();
    expect(flag.confidence).toBe('exact');
  });

  it('detects fuzzy match (same merchant, amount within $1, date within 2 days) → confidence=fuzzy', async () => {
    const existing = await Expense.create({
      userId,
      householdId,
      merchant: 'Target',
      amount: '50.00',
      date: '2026-02-15',
      source: 'camera',
      status: 'confirmed',
    });

    // slightly different amount and date
    const newExpense = await Expense.create({
      userId,
      householdId,
      merchant: 'Target',
      amount: '50.75',
      date: '2026-02-17',
      source: 'manual',
    });

    const flags = await detectDuplicates({
      id: newExpense.id,
      householdId: newExpense.household_id,
      merchant: newExpense.merchant,
      amount: newExpense.amount,
      date: '2026-02-17',
      mapkit_stable_id: null,
    });

    expect(flags.length).toBeGreaterThanOrEqual(1);
    const flag = flags.find(f =>
      (f.expense_id_a === newExpense.id && f.expense_id_b === existing.id) ||
      (f.expense_id_a === existing.id && f.expense_id_b === newExpense.id)
    );
    expect(flag).toBeDefined();
    expect(flag.confidence).toBe('fuzzy');
  });

  it('detects location match via mapkit_stable_id → confidence=uncertain', async () => {
    const stableId = 'mapkit-location-abc123';

    const existing = await Expense.create({
      userId,
      householdId,
      merchant: 'Coffee Place',
      amount: '12.00',
      date: '2026-03-01',
      source: 'manual',
      status: 'confirmed',
      mapkitStableId: stableId,
    });

    // Different merchant name but same location, different amount
    const newExpense = await Expense.create({
      userId,
      householdId,
      merchant: 'Coffeehouse',
      amount: '11.50',
      date: '2026-03-02',
      source: 'camera',
      mapkitStableId: stableId,
    });

    const flags = await detectDuplicates({
      id: newExpense.id,
      householdId: newExpense.household_id,
      merchant: newExpense.merchant,
      amount: newExpense.amount,
      date: '2026-03-02',
      mapkit_stable_id: stableId,
    });

    expect(flags.length).toBeGreaterThanOrEqual(1);
    const flag = flags.find(f =>
      (f.expense_id_a === newExpense.id && f.expense_id_b === existing.id) ||
      (f.expense_id_a === existing.id && f.expense_id_b === newExpense.id)
    );
    expect(flag).toBeDefined();
    expect(flag.confidence).toBe('uncertain');
  });

  it('does NOT flag duplicates from a different household', async () => {
    // Expense in household2
    const otherHouseholdExpense = await Expense.create({
      userId: userId2,
      householdId: householdId2,
      merchant: 'CrossHouseMerchant',
      amount: '99.00',
      date: '2026-03-05',
      source: 'manual',
      status: 'confirmed',
    });

    // New expense in household1 with same details
    const newExpense = await Expense.create({
      userId,
      householdId,
      merchant: 'CrossHouseMerchant',
      amount: '99.00',
      date: '2026-03-05',
      source: 'manual',
    });

    const flags = await detectDuplicates({
      id: newExpense.id,
      householdId: newExpense.household_id,
      merchant: newExpense.merchant,
      amount: newExpense.amount,
      date: '2026-03-05',
      mapkit_stable_id: null,
    });

    // Should not flag cross-household match
    const crossFlag = flags.find(f =>
      (f.expense_id_a === newExpense.id && f.expense_id_b === otherHouseholdExpense.id) ||
      (f.expense_id_a === otherHouseholdExpense.id && f.expense_id_b === newExpense.id)
    );
    expect(crossFlag).toBeUndefined();
  });

  it('creates DuplicateFlag rows in the DB (verify with DuplicateFlag.findByExpenseId)', async () => {
    const existing = await Expense.create({
      userId,
      householdId,
      merchant: 'BestBuy',
      amount: '200.00',
      date: '2026-03-10',
      source: 'email',
      status: 'confirmed',
    });

    const newExpense = await Expense.create({
      userId,
      householdId,
      merchant: 'BestBuy',
      amount: '200.00',
      date: '2026-03-10',
      source: 'manual',
    });

    await detectDuplicates({
      id: newExpense.id,
      householdId: newExpense.household_id,
      merchant: newExpense.merchant,
      amount: newExpense.amount,
      date: '2026-03-10',
      mapkit_stable_id: null,
    });

    const flagsFromDB = await DuplicateFlag.findByExpenseId(newExpense.id);

    expect(flagsFromDB.length).toBeGreaterThanOrEqual(1);
    const flag = flagsFromDB.find(f =>
      (f.expense_id_a === newExpense.id && f.expense_id_b === existing.id) ||
      (f.expense_id_a === existing.id && f.expense_id_b === newExpense.id)
    );
    expect(flag).toBeDefined();
    expect(flag.status).toBe('pending');
    expect(flag.confidence).toBe('exact');
  });
});
