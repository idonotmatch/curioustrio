const db = require('../../src/db');
const {
  detectRecurring,
  detectRecurringItems,
  detectRecurringItemSignals,
  getRecurringItemHistory,
  detectRecurringWatchCandidates,
} = require('../../src/services/recurringDetector');
const ExpenseItem = require('../../src/models/expenseItem');
const Product = require('../../src/models/product');

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
  await db.query(
    `DELETE FROM expense_items
     WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = $1)`,
    [testHouseholdId]
  );
  await db.query(`DELETE FROM expenses WHERE household_id = $1`, [testHouseholdId]);
  await db.query(`DELETE FROM products WHERE merchant IN ('Target') OR name IN ('Pampers Pure')`);
});

async function insertExpense(merchant, amount, date) {
  const result = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, amount, date, source, status)
     VALUES ($1, $2, $3, $4, $5, 'manual', 'confirmed')
     RETURNING id`,
    [testUserId, testHouseholdId, merchant, amount, date]
  );
  return result.rows[0].id;
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

describe('detectRecurringItems', () => {
  it('returns recurring item candidates with cadence and unit-price history', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 42);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 28);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 6.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 7.19, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 7.09, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 7.19, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 7.09, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const candidates = await detectRecurringItems(testHouseholdId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'item',
      item_name: 'Greek Yogurt',
      brand: 'Fage',
      frequency: 'monthly',
      average_gap_days: 14,
      occurrence_count: 3,
      normalized_total_size_value: 32,
      normalized_total_size_unit: 'oz',
    });
    expect(candidates[0].median_unit_price).toBeTruthy();
    expect(candidates[0].merchants).toEqual(['Whole Foods']);
  });
});

describe('detectRecurringItemSignals', () => {
  it('flags a meaningful price spike on the latest recurring purchase', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 42);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 28);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 6.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 7.09, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 9.49, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 7.09, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 9.49, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const signals = await detectRecurringItemSignals(testHouseholdId);
    expect(signals.some(s => s.signal === 'price_spike' && s.item_name === 'Greek Yogurt')).toBe(true);
  });

  it('flags cheaper elsewhere when another merchant has a meaningfully lower unit price', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 56);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 42);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 28);
    const d4 = new Date(today); d4.setDate(d4.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 8.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Trader Joes', 6.99, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Trader Joes', 6.89, d3.toISOString().split('T')[0]);
    const e4 = await insertExpense('Whole Foods', 9.19, d4.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 8.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 6.89, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e4, [{ description: 'Greek Yogurt', amount: 9.19, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const signals = await detectRecurringItemSignals(testHouseholdId);
    const cheaperElsewhere = signals.find(s => s.signal === 'cheaper_elsewhere' && s.item_name === 'Greek Yogurt');
    expect(cheaperElsewhere).toBeTruthy();
    expect(cheaperElsewhere.cheaper_merchant).toBe('Trader Joes');
  });
});

describe('getRecurringItemHistory', () => {
  it('returns purchase timeline and merchant pricing context for a recurring item', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 42);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 28);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Whole Foods', 6.99, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Trader Joes', 6.79, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 7.19, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Greek Yogurt', amount: 6.99, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Greek Yogurt', amount: 6.79, brand: 'Fage', product_size: '32', unit: 'oz' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Greek Yogurt', amount: 7.19, brand: 'Fage', product_size: '32', unit: 'oz' }]);

    const candidates = await detectRecurringItems(testHouseholdId);
    const history = await getRecurringItemHistory(testHouseholdId, candidates[0].group_key);

    expect(history).toMatchObject({
      kind: 'item_history',
      item_name: 'Greek Yogurt',
      brand: 'Fage',
      occurrence_count: 3,
      average_gap_days: 14,
      normalized_total_size_value: 32,
      normalized_total_size_unit: 'oz',
    });
    expect(history.purchases).toHaveLength(3);
    expect(history.merchant_price_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ merchant: 'Trader Joes', occurrence_count: 1 }),
        expect.objectContaining({ merchant: 'Whole Foods', occurrence_count: 2 }),
      ])
    );
  });
});

describe('detectRecurringWatchCandidates', () => {
  it('returns product-backed recurring items entering the watch window', async () => {
    const product = await Product.create({
      name: 'Pampers Pure',
      brand: 'Pampers',
      merchant: 'Target',
      productSize: '82',
      packSize: '1',
      unit: 'count',
    });

    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 50);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 32);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 14);

    const e1 = await insertExpense('Target', 39.23, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Target', 39.49, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Target', 39.19, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Pampers Pure', amount: 39.23, brand: 'Pampers', product_size: '82', unit: 'count', product_id: product.id }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Pampers Pure', amount: 39.49, brand: 'Pampers', product_size: '82', unit: 'count', product_id: product.id }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Pampers Pure', amount: 39.19, brand: 'Pampers', product_size: '82', unit: 'count', product_id: product.id }]);

    const candidates = await detectRecurringWatchCandidates(testHouseholdId, { windowDays: 5 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: 'watch_candidate',
      item_name: 'Pampers Pure',
      brand: 'Pampers',
      average_gap_days: 18,
      status: 'watching',
    });
    expect(candidates[0].days_until_due).toBeGreaterThanOrEqual(0);
    expect(candidates[0].days_until_due).toBeLessThanOrEqual(5);
  });

  it('does not return comparable-key-only items in the watch list yet', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 36);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 18);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 2);

    const e1 = await insertExpense('Whole Foods', 2.79, d1.toISOString().split('T')[0]);
    const e2 = await insertExpense('Whole Foods', 2.69, d2.toISOString().split('T')[0]);
    const e3 = await insertExpense('Whole Foods', 2.89, d3.toISOString().split('T')[0]);

    await ExpenseItem.createBulk(e1, [{ description: 'Organic Bananas', amount: 2.79, brand: null, product_size: '6', unit: 'count' }]);
    await ExpenseItem.createBulk(e2, [{ description: 'Organic Bananas', amount: 2.69, brand: null, product_size: '6', unit: 'count' }]);
    await ExpenseItem.createBulk(e3, [{ description: 'Organic Bananas', amount: 2.89, brand: null, product_size: '6', unit: 'count' }]);

    const candidates = await detectRecurringWatchCandidates(testHouseholdId, { windowDays: 5 });
    expect(candidates.find((item) => item.item_name === 'Organic Bananas')).toBeFalsy();
  });
});
