const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
  // Fail loudly at startup rather than getting a cryptic ENOENT/socket error.
  // Common cause: env var pasted without the scheme prefix (e.g. "//host..."
  // instead of "postgresql://host...").
  throw new Error(
    `DATABASE_URL is missing or malformed (got: "${dbUrl.slice(0, 40)}..."). ` +
    'It must start with postgresql:// or postgres://'
  );
}

const pool = new Pool({
  connectionString: dbUrl,
  // Supabase's connection pooler (PgBouncer) uses an intermediate certificate
  // that Node.js rejects with strict verification. Data is still encrypted over
  // SSL — we just skip the cert chain check. Set DB_SSL_REJECT_UNAUTHORIZED=true
  // to opt back in if connecting to a standard Postgres instance with a valid cert.
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
    : false,
  max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Default global categories — seeded once on first startup if the table is empty.
// These have household_id = NULL so every household sees them.
const DEFAULT_CATEGORIES = [
  { name: 'Groceries',      icon: '🛒', color: '#4ade80' },
  { name: 'Dining Out',     icon: '🍽️', color: '#f97316' },
  { name: 'Gas',            icon: '⛽', color: '#facc15' },
  { name: 'Household',      icon: '🏠', color: '#60a5fa' },
  { name: 'Kids',           icon: '👶', color: '#c084fc' },
  { name: 'Healthcare',     icon: '💊', color: '#f43f5e' },
  { name: 'Subscriptions',  icon: '📱', color: '#a78bfa' },
  { name: 'Entertainment',  icon: '🎬', color: '#fb923c' },
  { name: 'Shopping',       icon: '🛍️', color: '#38bdf8' },
  { name: 'Travel',         icon: '✈️', color: '#34d399' },
  { name: 'Other',          icon: '📌', color: '#94a3b8' },
];

async function seedDefaultCategories() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM categories WHERE household_id IS NULL`
    );
    if (Number(rows[0].n) > 0) return; // already seeded

    for (const cat of DEFAULT_CATEGORIES) {
      await pool.query(
        `INSERT INTO categories (name, icon, color) VALUES ($1, $2, $3)`,
        [cat.name, cat.icon, cat.color]
      );
    }
    console.log(`[db] Seeded ${DEFAULT_CATEGORIES.length} default categories`);
  } catch (err) {
    // Non-fatal — categories may already exist or DB may not be ready yet
    console.error('[db] seedDefaultCategories error (non-fatal):', err.message);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  DEFAULT_CATEGORIES,
  seedDefaultCategories,
};
