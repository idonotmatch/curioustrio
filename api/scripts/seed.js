#!/usr/bin/env node
/**
 * Seed script — populates dummy expenses for the first user in the DB.
 * Run after logging into the app at least once (which creates your user record).
 *
 * Usage:
 *   cd api && node scripts/seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

async function main() {
  // 1. Find the first user
  const userRes = await q('SELECT * FROM users ORDER BY created_at ASC LIMIT 1');
  if (!userRes.rows.length) {
    console.error('No users found. Log into the app first, then run this script.');
    process.exit(1);
  }
  const user = userRes.rows[0];
  console.log(`Seeding for user: ${user.name} (${user.email})`);

  // 2. Ensure household
  let householdId = user.household_id;
  if (!householdId) {
    const hRes = await q(
      `INSERT INTO households (name) VALUES ($1) RETURNING id`,
      ['My Household']
    );
    householdId = hRes.rows[0].id;
    await q('UPDATE users SET household_id = $1 WHERE id = $2', [householdId, user.id]);
    console.log(`Created household: ${householdId}`);
  } else {
    console.log(`Using existing household: ${householdId}`);
  }

  // 3. Upsert categories
  const categoryDefs = [
    { name: 'Groceries', icon: '🛒', color: '#22c55e' },
    { name: 'Dining Out', icon: '🍽️', color: '#f97316' },
    { name: 'Transport', icon: '🚗', color: '#3b82f6' },
    { name: 'Shopping', icon: '🛍️', color: '#a855f7' },
    { name: 'Health', icon: '💊', color: '#ef4444' },
    { name: 'Utilities', icon: '💡', color: '#eab308' },
    { name: 'Entertainment', icon: '🎬', color: '#ec4899' },
  ];

  const categoryIds = {};
  for (const cat of categoryDefs) {
    // Find or create per household
    const existing = await q(
      'SELECT id FROM categories WHERE household_id = $1 AND name = $2',
      [householdId, cat.name]
    );
    if (existing.rows.length) {
      categoryIds[cat.name] = existing.rows[0].id;
    } else {
      const res = await q(
        'INSERT INTO categories (household_id, name, icon, color) VALUES ($1,$2,$3,$4) RETURNING id',
        [householdId, cat.name, cat.icon, cat.color]
      );
      categoryIds[cat.name] = res.rows[0].id;
    }
  }
  console.log('Categories ready:', Object.keys(categoryIds).join(', '));

  // 4. Seed expenses (current month, spread across last 30 days)
  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  };

  const expenses = [
    { merchant: 'Trader Joe\'s', amount: 84.32, date: daysAgo(1), category: 'Groceries', source: 'manual', notes: 'Weekly groceries' },
    { merchant: 'Whole Foods', amount: 47.18, date: daysAgo(3), category: 'Groceries', source: 'manual', notes: null },
    { merchant: 'Chipotle', amount: 23.45, date: daysAgo(2), category: 'Dining Out', source: 'manual', notes: 'Lunch' },
    { merchant: 'Nobu', amount: 142.00, date: daysAgo(5), category: 'Dining Out', source: 'manual', notes: 'Anniversary dinner' },
    { merchant: 'Uber', amount: 18.50, date: daysAgo(1), category: 'Transport', source: 'manual', notes: null },
    { merchant: 'Caltrain', amount: 9.75, date: daysAgo(4), category: 'Transport', source: 'manual', notes: null },
    { merchant: 'Amazon', amount: 67.99, date: daysAgo(6), category: 'Shopping', source: 'manual', notes: 'Kitchen supplies' },
    { merchant: 'Target', amount: 52.14, date: daysAgo(8), category: 'Shopping', source: 'manual', notes: null },
    { merchant: 'CVS Pharmacy', amount: 34.20, date: daysAgo(3), category: 'Health', source: 'manual', notes: 'Vitamins' },
    { merchant: 'PG&E', amount: 112.00, date: daysAgo(10), category: 'Utilities', source: 'manual', notes: 'Electric bill' },
    { merchant: 'Netflix', amount: 22.99, date: daysAgo(12), category: 'Entertainment', source: 'manual', notes: null },
    { merchant: 'Spotify', amount: 16.99, date: daysAgo(14), category: 'Entertainment', source: 'manual', notes: null },
    { merchant: 'Costco', amount: 198.44, date: daysAgo(7), category: 'Groceries', source: 'manual', notes: 'Bulk run' },
    { merchant: 'Starbucks', amount: 7.85, date: daysAgo(0), category: 'Dining Out', source: 'manual', notes: 'Morning coffee' },
    { merchant: 'Amazon', amount: -24.99, date: daysAgo(2), category: 'Shopping', source: 'refund', notes: 'Return — wrong size' },
  ];

  let inserted = 0;
  for (const e of expenses) {
    const catId = categoryIds[e.category] || null;
    await q(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8)`,
      [user.id, householdId, e.merchant, e.amount, e.date, catId, e.source, e.notes]
    );
    inserted++;
  }

  console.log(`✓ Inserted ${inserted} expenses`);
  console.log('Done! Start the app and check the Feed tab.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
