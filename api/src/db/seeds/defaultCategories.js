// Run: node api/src/db/seeds/defaultCategories.js
require('dotenv').config({ path: 'api/.env' });
const db = require('../index');

const defaults = [
  { name: 'Groceries', icon: '🛒', color: '#4ade80' },
  { name: 'Dining Out', icon: '🍽️', color: '#f97316' },
  { name: 'Gas', icon: '⛽', color: '#facc15' },
  { name: 'Household', icon: '🏠', color: '#60a5fa' },
  { name: 'Kids', icon: '👶', color: '#c084fc' },
  { name: 'Healthcare', icon: '💊', color: '#f43f5e' },
  { name: 'Subscriptions', icon: '📱', color: '#a78bfa' },
  { name: 'Entertainment', icon: '🎬', color: '#fb923c' },
  { name: 'Shopping', icon: '🛍️', color: '#38bdf8' },
  { name: 'Travel', icon: '✈️', color: '#34d399' },
  { name: 'Other', icon: '📌', color: '#94a3b8' },
];

async function seed() {
  for (const cat of defaults) {
    await db.query(
      `INSERT INTO categories (name, icon, color)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [cat.name, cat.icon, cat.color]
    );
  }
  console.log('Default categories seeded');
  await db.pool.end();
}

seed().catch(console.error);
