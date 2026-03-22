#!/usr/bin/env node
/**
 * Seed script — clears and repopulates realistic data for testing all app features.
 *
 * What it seeds:
 *   - Parent + child category hierarchy
 *   - Monthly budget
 *   - 20+ expenses spread across the month (mine + a dummy household partner)
 *   - Expenses with line items (for receipt/email sources)
 *   - Refunds, private expenses, payment method variations
 *
 * Usage:
 *   cd api && node scripts/seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

async function main() {
  // ── 1. Find primary user ──────────────────────────────────────────────────
  const userRes = await q('SELECT * FROM users ORDER BY created_at ASC LIMIT 1');
  if (!userRes.rows.length) {
    console.error('No users found. Log into the app first, then run this script.');
    process.exit(1);
  }
  const user = userRes.rows[0];
  console.log(`Seeding for user: ${user.name || user.email}`);

  // ── 2. Ensure household ───────────────────────────────────────────────────
  let householdId = user.household_id;
  if (!householdId) {
    const hRes = await q(`INSERT INTO households (name) VALUES ($1) RETURNING id`, ['My Household']);
    householdId = hRes.rows[0].id;
    await q('UPDATE users SET household_id = $1 WHERE id = $2', [householdId, user.id]);
    console.log(`Created household: ${householdId}`);
  } else {
    console.log(`Using existing household: ${householdId}`);
  }

  // ── 3. Ensure dummy partner user ──────────────────────────────────────────
  let partnerId;
  const partnerRes = await q(
    `SELECT id FROM users WHERE household_id = $1 AND id != $2 LIMIT 1`,
    [householdId, user.id]
  );
  if (partnerRes.rows.length) {
    partnerId = partnerRes.rows[0].id;
    console.log(`Using existing partner: ${partnerId}`);
  } else {
    const pRes = await q(
      `INSERT INTO users (auth0_id, name, email, household_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['seed|partner', 'Alex (partner)', 'alex@example.com', householdId]
    );
    partnerId = pRes.rows[0].id;
    console.log(`Created partner user: ${partnerId}`);
  }

  // ── 4. Clear existing seeded data ─────────────────────────────────────────
  await q(`DELETE FROM expense_items WHERE expense_id IN (
    SELECT id FROM expenses WHERE household_id = $1
  )`, [householdId]);
  await q(`DELETE FROM expenses WHERE household_id = $1`, [householdId]);
  await q(`DELETE FROM category_suggestions WHERE household_id = $1`, [householdId]);
  await q(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
  await q(`DELETE FROM budget_settings WHERE household_id = $1`, [householdId]);
  console.log('Cleared existing data');

  // ── 5. Category hierarchy ─────────────────────────────────────────────────
  //  Parent categories (no parent_id)
  const parents = {};
  for (const [name] of [['Food'], ['Home'], ['Transport'], ['Personal'], ['Health']]) {
    const r = await q(
      `INSERT INTO categories (household_id, name) VALUES ($1, $2) RETURNING id`,
      [householdId, name]
    );
    parents[name] = r.rows[0].id;
  }

  // Child categories (with parent_id)
  const cats = {};
  const childDefs = [
    // Food
    { name: 'Groceries',    parent: 'Food' },
    { name: 'Dining Out',   parent: 'Food' },
    { name: 'Coffee',       parent: 'Food' },
    // Home
    { name: 'Utilities',    parent: 'Home' },
    { name: 'Rent',         parent: 'Home' },
    { name: 'Household Supplies', parent: 'Home' },
    // Transport
    { name: 'Gas',          parent: 'Transport' },
    { name: 'Rideshare',    parent: 'Transport' },
    { name: 'Parking',      parent: 'Transport' },
    // Personal
    { name: 'Clothing',     parent: 'Personal' },
    { name: 'Entertainment',parent: 'Personal' },
    { name: 'Subscriptions',parent: 'Personal' },
    // Health
    { name: 'Pharmacy',     parent: 'Health' },
    { name: 'Gym',          parent: 'Health' },
  ];
  for (const { name, parent } of childDefs) {
    const r = await q(
      `INSERT INTO categories (household_id, name, parent_id) VALUES ($1, $2, $3) RETURNING id`,
      [householdId, name, parents[parent]]
    );
    cats[name] = r.rows[0].id;
  }
  console.log(`Created ${Object.keys(parents).length} parent + ${Object.keys(cats).length} child categories`);

  // ── 6. Monthly budget ─────────────────────────────────────────────────────
  // category_id = NULL means the total household budget
  await q(
    `INSERT INTO budget_settings (household_id, category_id, monthly_limit)
     VALUES ($1, NULL, $2)
     ON CONFLICT (household_id, category_id) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
    [householdId, 3500]
  );
  console.log('Set monthly budget: $3500');

  // ── 7. Expenses ───────────────────────────────────────────────────────────
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  };

  // Helper to insert an expense and return its id
  async function insertExpense({ userId, merchant, description, amount, date, category, source, notes, paymentMethod, cardLast4, cardLabel, isPrivate }) {
    const catId = cats[category] || null;
    const r = await q(
      `INSERT INTO expenses
         (user_id, household_id, merchant, description, amount, date, category_id,
          source, status, notes, payment_method, card_last4, card_label, is_private)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        userId, householdId,
        merchant || null, description || null,
        amount, date, catId,
        source, notes || null,
        paymentMethod || 'unknown', cardLast4 || null, cardLabel || null,
        isPrivate || false,
      ]
    );
    return r.rows[0].id;
  }

  // ── My expenses ────────────────────────────────────────────────────────────
  const myExpenses = [
    // Groceries w/ line items
    {
      merchant: "Trader Joe's", amount: 84.32, date: daysAgo(1),
      category: 'Groceries', source: 'camera',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      items: [
        { description: 'Organic whole milk (2)', amount: 9.98 },
        { description: 'Free range eggs', amount: 4.49 },
        { description: 'Sourdough bread', amount: 4.99 },
        { description: 'Chicken thighs', amount: 12.99 },
        { description: 'Baby spinach', amount: 3.49 },
        { description: 'Almond butter', amount: 7.99 },
        { description: 'Frozen edamame', amount: 3.29 },
        { description: 'Orange juice', amount: 5.99 },
        { description: 'Greek yogurt pack', amount: 8.99 },
        { description: 'Misc items', amount: 22.12 },
      ],
    },
    {
      merchant: 'Whole Foods', amount: 62.47, date: daysAgo(8),
      category: 'Groceries', source: 'manual',
      paymentMethod: 'debit', cardLast4: '9876', cardLabel: 'Chase Checking',
    },
    {
      merchant: 'Costco', amount: 198.44, date: daysAgo(14),
      category: 'Groceries', source: 'manual',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      items: [
        { description: 'Paper towels (12pk)', amount: 22.99 },
        { description: 'Laundry detergent', amount: 18.99 },
        { description: 'Chicken breast (5lb)', amount: 19.99 },
        { description: 'Frozen salmon', amount: 29.99 },
        { description: 'Mixed nuts', amount: 17.99 },
        { description: 'Sparkling water (36pk)', amount: 14.99 },
        { description: 'Olive oil', amount: 15.99 },
        { description: 'Misc', amount: 57.51 },
      ],
    },
    // Dining
    {
      merchant: 'Chipotle', amount: 23.45, date: daysAgo(2),
      category: 'Dining Out', source: 'manual',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      notes: 'Lunch with coworker',
    },
    {
      merchant: 'Nobu', amount: 142.00, date: daysAgo(5),
      category: 'Dining Out', source: 'manual',
      paymentMethod: 'credit', cardLast4: '1234', cardLabel: 'Amex Gold',
      notes: 'Anniversary dinner',
      items: [
        { description: 'Black cod miso', amount: 42.00 },
        { description: 'Yellowtail jalapeño', amount: 28.00 },
        { description: 'Wagyu gyoza', amount: 24.00 },
        { description: 'Cocktails (x2)', amount: 36.00 },
        { description: 'Dessert', amount: 12.00 },
      ],
    },
    {
      merchant: 'Starbucks', amount: 7.85, date: daysAgo(0),
      category: 'Coffee', source: 'manual', paymentMethod: 'debit',
    },
    {
      merchant: 'Blue Bottle Coffee', amount: 12.50, date: daysAgo(3),
      category: 'Coffee', source: 'manual', paymentMethod: 'cash',
    },
    // Transport
    {
      merchant: 'Uber', amount: 18.50, date: daysAgo(1),
      category: 'Rideshare', source: 'manual', paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
    },
    {
      merchant: 'Shell', amount: 72.40, date: daysAgo(4),
      category: 'Gas', source: 'manual', paymentMethod: 'debit',
    },
    // Utilities / Home
    {
      merchant: 'PG&E', amount: 112.00, date: daysAgo(10),
      category: 'Utilities', source: 'manual', notes: 'Electric bill',
      paymentMethod: 'debit',
    },
    {
      merchant: 'Comcast', amount: 89.99, date: daysAgo(12),
      category: 'Utilities', source: 'manual', notes: 'Internet',
      paymentMethod: 'debit',
    },
    // Subscriptions w/ email source
    {
      merchant: 'Apple', amount: 32.95, date: daysAgo(6),
      category: 'Subscriptions', source: 'email', notes: 'Apple One family',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      items: [
        { description: 'Apple One Family (monthly)', amount: 32.95 },
      ],
    },
    {
      merchant: 'Netflix', amount: 22.99, date: daysAgo(15),
      category: 'Subscriptions', source: 'email',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      items: [{ description: 'Netflix Premium (monthly)', amount: 22.99 }],
    },
    {
      merchant: 'Spotify', amount: 16.99, date: daysAgo(15),
      category: 'Subscriptions', source: 'manual',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
    },
    // Personal
    {
      merchant: 'Amazon', amount: 67.99, date: daysAgo(6),
      category: 'Household Supplies', source: 'email', notes: 'Kitchen supplies',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
      items: [
        { description: 'Instant Pot lid replacement', amount: 18.99 },
        { description: 'Silicone spatula set', amount: 14.99 },
        { description: 'Glass food containers (set of 8)', amount: 34.01 },
      ],
    },
    {
      merchant: 'CVS Pharmacy', amount: 34.20, date: daysAgo(3),
      category: 'Pharmacy', source: 'manual', notes: 'Vitamins + cold medicine',
      paymentMethod: 'debit',
    },
    {
      merchant: 'Equinox', amount: 185.00, date: daysAgo(20),
      category: 'Gym', source: 'manual', notes: 'Monthly membership',
      paymentMethod: 'credit', cardLast4: '4242', cardLabel: 'Chase Sapphire',
    },
    // Refund
    {
      merchant: 'Amazon', amount: -24.99, date: daysAgo(2),
      category: 'Household Supplies', source: 'refund', notes: 'Return — wrong size',
    },
    // Private expense
    {
      merchant: 'Surprise gift', amount: 89.00, date: daysAgo(4),
      category: 'Personal', source: 'manual', isPrivate: true,
      paymentMethod: 'credit', cardLast4: '1234', cardLabel: 'Amex Gold',
    },
  ];

  // ── Partner expenses (for Household toggle) ────────────────────────────────
  const partnerExpenses = [
    {
      merchant: 'Safeway', amount: 91.30, date: daysAgo(2),
      category: 'Groceries', source: 'manual',
      paymentMethod: 'debit',
    },
    {
      merchant: 'Lyft', amount: 14.25, date: daysAgo(1),
      category: 'Rideshare', source: 'manual',
      paymentMethod: 'credit', cardLast4: '5555', cardLabel: 'Citi Double Cash',
    },
    {
      merchant: 'Philz Coffee', amount: 9.50, date: daysAgo(0),
      category: 'Coffee', source: 'manual',
      paymentMethod: 'cash',
    },
    {
      merchant: 'Walgreens', amount: 28.60, date: daysAgo(3),
      category: 'Pharmacy', source: 'manual',
      paymentMethod: 'debit',
    },
    {
      merchant: 'Target', amount: 74.18, date: daysAgo(5),
      category: 'Household Supplies', source: 'manual',
      paymentMethod: 'debit',
    },
    {
      merchant: 'Cheesecake Factory', amount: 68.00, date: daysAgo(7),
      category: 'Dining Out', source: 'manual',
      notes: 'Girls night out',
      paymentMethod: 'credit', cardLast4: '5555', cardLabel: 'Citi Double Cash',
    },
    {
      merchant: 'Chevron', amount: 65.80, date: daysAgo(9),
      category: 'Gas', source: 'manual',
      paymentMethod: 'debit',
    },
  ];

  let myCount = 0;
  for (const e of myExpenses) {
    const expenseId = await insertExpense({ userId: user.id, ...e });
    if (e.items?.length) {
      for (const item of e.items) {
        await q(
          `INSERT INTO expense_items (expense_id, description, amount) VALUES ($1,$2,$3)`,
          [expenseId, item.description, item.amount]
        );
      }
    }
    myCount++;
  }

  let partnerCount = 0;
  for (const e of partnerExpenses) {
    await insertExpense({ userId: partnerId, ...e });
    partnerCount++;
  }

  const lineItemCount = myExpenses.reduce((s, e) => s + (e.items?.length || 0), 0);

  console.log(`✓ Inserted ${myCount} expenses for you (${lineItemCount} line items)`);
  console.log(`✓ Inserted ${partnerCount} expenses for Alex (partner)`);
  console.log(`\nTotal household spend this month: ~$${
    [...myExpenses, ...partnerExpenses]
      .filter(e => e.amount > 0)
      .reduce((s, e) => s + e.amount, 0)
      .toFixed(0)
  } vs $3500 budget`);
  console.log('\nDone! Pull to refresh in the app.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
