// Run: node api/src/db/seeds/defaultCategories.js
require('dotenv').config({ path: 'api/.env' });
const db = require('../index');

async function seed() {
  await db.seedDefaultCategories();
  await db.pool.end();
}

seed().catch(console.error);
