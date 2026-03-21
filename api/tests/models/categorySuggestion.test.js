// api/tests/models/categorySuggestion.test.js
const db = require('../../src/db');
const CategorySuggestion = require('../../src/models/categorySuggestion');

// We need a household, two categories (leaf + parent), and the user in DB.
// The test DB has user auth0|test-user-123 from other test suites.
// We create ad-hoc categories for isolation.

let householdId, parentId, leafId, suggestionId;

beforeAll(async () => {
  // Find or create a household for the test user
  const userRes = await db.query("SELECT household_id FROM users WHERE auth0_id = 'auth0|test-user-123'");
  householdId = userRes.rows[0]?.household_id;
  if (!householdId) {
    const hRes = await db.query("INSERT INTO households (name) VALUES ('SuggTest') RETURNING id");
    householdId = hRes.rows[0].id;
    await db.query("UPDATE users SET household_id = $1 WHERE auth0_id = 'auth0|test-user-123'", [householdId]);
  }
  const pRes = await db.query(
    "INSERT INTO categories (household_id, name) VALUES ($1, 'SGParent') RETURNING id",
    [householdId]
  );
  parentId = pRes.rows[0].id;
  const lRes = await db.query(
    "INSERT INTO categories (household_id, name) VALUES ($1, 'SGLeaf') RETURNING id",
    [householdId]
  );
  leafId = lRes.rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM category_suggestions WHERE household_id = $1', [householdId]);
  await db.query("DELETE FROM categories WHERE name IN ('SGParent', 'SGLeaf')");
  await db.pool.end();
});

describe('CategorySuggestion.upsertForLeaf', () => {
  it('inserts a pending suggestion', async () => {
    await CategorySuggestion.upsertForLeaf(householdId, leafId, parentId);
    const res = await db.query(
      "SELECT * FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
      [householdId, leafId]
    );
    expect(res.rows).toHaveLength(1);
    suggestionId = res.rows[0].id;
  });

  it('replaces existing pending suggestion for same leaf', async () => {
    await CategorySuggestion.upsertForLeaf(householdId, leafId, parentId);
    const res = await db.query(
      "SELECT * FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
      [householdId, leafId]
    );
    expect(res.rows).toHaveLength(1);
    suggestionId = res.rows[0].id;
  });
});

describe('CategorySuggestion.countPending', () => {
  it('returns count of pending suggestions', async () => {
    const count = await CategorySuggestion.countPending(householdId);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe('CategorySuggestion.getPending', () => {
  it('returns pending suggestions with leaf and parent details', async () => {
    const suggestions = await CategorySuggestion.getPending(householdId);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const s = suggestions.find(s => s.id === suggestionId);
    expect(s).toBeDefined();
    expect(s.leaf.name).toBe('SGLeaf');
    expect(s.suggested_parent.name).toBe('SGParent');
  });
});

describe('CategorySuggestion.reject', () => {
  it('sets status to rejected', async () => {
    const result = await CategorySuggestion.reject(suggestionId, householdId);
    expect(result).not.toBeNull();
    const check = await db.query('SELECT status FROM category_suggestions WHERE id = $1', [suggestionId]);
    expect(check.rows[0].status).toBe('rejected');
  });
});

describe('CategorySuggestion.accept', () => {
  it('sets status to accepted and updates leaf parent_id', async () => {
    // Insert a fresh suggestion to accept
    await CategorySuggestion.upsertForLeaf(householdId, leafId, parentId);
    const res = await db.query(
      "SELECT id FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
      [householdId, leafId]
    );
    const newId = res.rows[0].id;

    await CategorySuggestion.accept(newId, householdId);

    const check = await db.query('SELECT status FROM category_suggestions WHERE id = $1', [newId]);
    expect(check.rows[0].status).toBe('accepted');

    const catCheck = await db.query('SELECT parent_id FROM categories WHERE id = $1', [leafId]);
    expect(catCheck.rows[0].parent_id).toBe(parentId);
  });
});
