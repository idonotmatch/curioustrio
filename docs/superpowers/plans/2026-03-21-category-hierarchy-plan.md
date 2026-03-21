# Category Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-level parent/child category hierarchy with AI-powered leaf-to-parent suggestions, rolling up throughout the feed, categories page, and summary budget view.

**Architecture:** Self-referential `parent_id` column on categories; a new `category_suggestions` table stores pending AI mappings. The API returns `parent_name` in expense queries, a `by_parent` budget rollup, and a restructured `GET /categories` response. Mobile surfaces hierarchy in three places: the categories management page (grouped list + suggestions card), the feed expense card (parent label), and the summary budget breakdown.

**Tech Stack:** Node.js/Express, PostgreSQL 15, React Native / Expo SDK 55, `@anthropic-ai/sdk` via `api/src/services/ai.js`

---

## File Map

| File | Change |
|------|--------|
| `api/src/db/migrations/007_category_hierarchy.sql` | **Create** — `parent_id` column + `category_suggestions` table |
| `api/src/models/category.js` | **Modify** — self-join for `parent_name`; accept `parent_id` in create/update |
| `api/src/models/categorySuggestion.js` | **Create** — getPending, countPending, upsertForLeaf, accept, reject |
| `api/src/services/categorySuggester.js` | **Create** — calls AI, stores suggestions; non-fatal |
| `api/src/routes/categories.js` | **Modify** — new response shape; `parent_id` in POST/PATCH; suggestion endpoints |
| `api/src/routes/budgets.js` | **Modify** — add `by_parent` rollup to GET response |
| `api/src/models/expense.js` | **Modify** — add `category_parent_name` via second LEFT JOIN |
| `mobile/app/categories.js` | **Rewrite** — grouped list, suggestions card, parent chip in add form |
| `mobile/app/(tabs)/settings.js` | **Modify** — red dot badge on Categories row |
| `mobile/components/ExpenseItem.js` | **Modify** — show `category_parent_name` instead of `category_name` |
| `mobile/app/(tabs)/summary.js` | **Modify** — per-parent budget rows below household card |
| `api/tests/models/categorySuggestion.test.js` | **Create** |
| `api/tests/services/categorySuggester.test.js` | **Create** |
| `api/tests/routes/categories.test.js` | **Modify** — add hierarchy + suggestion tests |
| `api/tests/routes/budgets.test.js` | **Modify** — add `by_parent` test |

---

## Task 1: DB Migration

**Files:**
- Create: `api/src/db/migrations/007_category_hierarchy.sql`

- [ ] **Step 1: Write migration file**

```sql
-- api/src/db/migrations/007_category_hierarchy.sql

ALTER TABLE categories ADD COLUMN parent_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE category_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  leaf_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  suggested_parent_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX category_suggestions_household_idx ON category_suggestions(household_id);
```

- [ ] **Step 2: Run migration**

```bash
psql $DATABASE_URL -f api/src/db/migrations/007_category_hierarchy.sql
```

Expected: `ALTER TABLE` then `CREATE TABLE` then `CREATE INDEX` — no errors.

- [ ] **Step 3: Verify column exists**

```bash
psql $DATABASE_URL -c "\d categories"
```

Expected: `parent_id` column visible in output with type `uuid`.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/007_category_hierarchy.sql
git commit -m "feat: migration 007 — category parent_id + category_suggestions table"
```

---

## Task 2: Category Model — parent_id support

**Files:**
- Modify: `api/src/models/category.js`
- Test: `api/tests/routes/categories.test.js` (reuse existing file for model coverage via routes)

The model needs three changes: (1) `findByHousehold` returns `parent_name` via self-join, (2) `create` accepts `parentId`, (3) `update` accepts `parentId` with null-able semantics.

- [ ] **Step 1: Write a failing test for parent_name in GET /categories**

Add to `api/tests/routes/categories.test.js` — insert at the end of the file (before the closing):

```js
describe('category hierarchy — parent_name', () => {
  it('GET /categories returns parent_name field on each category', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    // New shape: { categories, pending_suggestions_count }
    expect(res.body).toHaveProperty('categories');
    expect(res.body).toHaveProperty('pending_suggestions_count');
    expect(Array.isArray(res.body.categories)).toBe(true);
    const cat = res.body.categories[0];
    if (cat) {
      expect(cat).toHaveProperty('parent_name'); // null or string
    }
  });

  it('POST /categories accepts parent_id', async () => {
    const parent = await request(app)
      .post('/categories')
      .send({ name: 'ParentCat' });
    expect(parent.status).toBe(201);

    const child = await request(app)
      .post('/categories')
      .send({ name: 'ChildCat', parent_id: parent.body.id });
    expect(child.status).toBe(201);
    expect(child.body.parent_id).toBe(parent.body.id);

    // cleanup
    await request(app).delete(`/categories/${child.body.id}`);
    await request(app).delete(`/categories/${parent.body.id}`);
  });

  it('PATCH /categories/:id accepts parent_id to assign and null to unassign', async () => {
    const parent = await request(app).post('/categories').send({ name: 'PatchParent' });
    const leaf = await request(app).post('/categories').send({ name: 'PatchLeaf' });

    // assign
    const assign = await request(app)
      .patch(`/categories/${leaf.body.id}`)
      .send({ parent_id: parent.body.id });
    expect(assign.status).toBe(200);
    expect(assign.body.parent_id).toBe(parent.body.id);

    // unassign
    const unassign = await request(app)
      .patch(`/categories/${leaf.body.id}`)
      .send({ parent_id: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.parent_id).toBeNull();

    // cleanup
    await request(app).delete(`/categories/${leaf.body.id}`);
    await request(app).delete(`/categories/${parent.body.id}`);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd api && npx jest tests/routes/categories.test.js --no-coverage 2>&1 | tail -20
```

Expected: new tests fail (shape is array not object; `parent_name` not on rows).

- [ ] **Step 3: Update `api/src/models/category.js`**

Replace the full file:

```js
const db = require('../db');

async function findByHousehold(householdId) {
  const result = await db.query(
    `SELECT c.*, p.name AS parent_name
     FROM categories c
     LEFT JOIN categories p ON c.parent_id = p.id
     WHERE c.household_id = $1 OR c.household_id IS NULL
     ORDER BY c.name`,
    [householdId]
  );
  return result.rows;
}

async function create({ householdId, name, icon, color, parentId = null }) {
  const result = await db.query(
    `INSERT INTO categories (household_id, name, icon, color, parent_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [householdId, name, icon, color, parentId]
  );
  return result.rows[0];
}

async function update({ id, householdId, name, icon, color, parentId }) {
  // parentId === undefined → don't touch parent_id column
  // parentId === null      → explicitly unassign
  // parentId === 'uuid'    → assign to parent
  const hasParent = parentId !== undefined;
  const params = hasParent
    ? [id, householdId, name, icon, color, parentId]
    : [id, householdId, name, icon, color];

  const result = await db.query(
    `UPDATE categories
     SET name  = COALESCE($3, name),
         icon  = COALESCE($4, icon),
         color = COALESCE($5, color)
         ${hasParent ? ', parent_id = $6' : ''}
     WHERE id = $1
       AND (household_id = $2 OR (household_id IS NULL AND $2 IS NULL))
     RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

async function remove({ id, householdId }) {
  await db.query(
    'DELETE FROM categories WHERE id = $1 AND household_id = $2',
    [id, householdId]
  );
}

module.exports = { findByHousehold, create, update, remove };
```

- [ ] **Step 4: Update `api/src/routes/categories.js` — shape + parent_id passthrough**

Replace the full file:

```js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Category = require('../models/category');
const CategorySuggestion = require('../models/categorySuggestion');
const categorySuggester = require('../services/categorySuggester');

router.use(authenticate);

async function getUser(req) {
  return User.findByAuth0Id(req.auth0Id);
}

// GET /categories — { categories, pending_suggestions_count }
router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const categories = await Category.findByHousehold(user?.household_id);
    const pending_suggestions_count = user?.household_id
      ? await CategorySuggestion.countPending(user.household_id)
      : 0;
    res.json({ categories, pending_suggestions_count });
  } catch (err) { next(err); }
});

// GET /categories/suggestions
router.get('/suggestions', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.json([]);
    const suggestions = await CategorySuggestion.getPending(user.household_id);
    res.json(suggestions);
  } catch (err) { next(err); }
});

// POST /categories/suggestions/:id/accept
router.post('/suggestions/:id/accept', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'No household' });
    const result = await CategorySuggestion.accept(req.params.id, user.household_id);
    if (!result) return res.status(404).json({ error: 'Suggestion not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /categories/suggestions/:id/reject
router.post('/suggestions/:id/reject', async (req, res, next) => {
  try {
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'No household' });
    const result = await CategorySuggestion.reject(req.params.id, user.household_id);
    if (!result) return res.status(404).json({ error: 'Suggestion not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /categories
router.post('/', async (req, res, next) => {
  try {
    const { name, icon, color, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    const category = await Category.create({
      householdId: user?.household_id,
      name,
      icon,
      color,
      parentId: parent_id || null,
    });
    // Fire background AI suggestions if creating a top-level category (no parent)
    if (!parent_id && user?.household_id) {
      categorySuggester.suggest(user.household_id, category.id).catch(() => {});
    }
    res.status(201).json(category);
  } catch (err) { next(err); }
});

// PATCH /categories/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, icon, color } = req.body;
    const parentId = 'parent_id' in req.body ? req.body.parent_id : undefined;
    const user = await getUser(req);
    const category = await Category.update({
      id: req.params.id,
      householdId: user?.household_id,
      name,
      icon,
      color,
      parentId,
    });
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.json(category);
  } catch (err) { next(err); }
});

// DELETE /categories/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    await Category.remove({ id: req.params.id, householdId: user?.household_id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
```

**Note:** `CategorySuggestion` and `categorySuggester` don't exist yet. Tests will fail until Tasks 3 and 4. That is expected.

- [ ] **Step 5: Run the hierarchy tests (partial pass expected)**

```bash
cd api && npx jest tests/routes/categories.test.js --no-coverage 2>&1 | tail -30
```

Expected: the three new hierarchy tests pass. The original tests may fail due to the response shape change (array → object). That's fine — fix them now:

In `api/tests/routes/categories.test.js`, update the `GET /categories` test at line 18:

```js
describe('GET /categories', () => {
  it('returns categories for the user household', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('categories');
    expect(Array.isArray(res.body.categories)).toBe(true);
  });
});
```

And update the POST test at line 27 (the `creates a category` test) to just check `res.body.name` — no change needed there, `POST /categories` still returns a single category object.

- [ ] **Step 6: Run all category tests**

```bash
cd api && npx jest tests/routes/categories.test.js --no-coverage 2>&1 | tail -20
```

Expected: all pass (some may skip due to missing modules — that will resolve in Tasks 3–4).

- [ ] **Step 7: Commit**

```bash
git add api/src/models/category.js api/src/routes/categories.js api/tests/routes/categories.test.js
git commit -m "feat: category model + routes — parent_id, parent_name, new response shape"
```

---

## Task 3: CategorySuggestion Model

**Files:**
- Create: `api/src/models/categorySuggestion.js`
- Create: `api/tests/models/categorySuggestion.test.js`

- [ ] **Step 1: Write the test file**

```js
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
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd api && npx jest tests/models/categorySuggestion.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../src/models/categorySuggestion'`

- [ ] **Step 3: Create `api/src/models/categorySuggestion.js`**

```js
const db = require('../db');

async function countPending(householdId) {
  const result = await db.query(
    "SELECT COUNT(*) FROM category_suggestions WHERE household_id = $1 AND status = 'pending'",
    [householdId]
  );
  return parseInt(result.rows[0].count, 10);
}

async function getPending(householdId) {
  const result = await db.query(
    `SELECT cs.id,
            leaf.id   AS leaf_id,   leaf.name   AS leaf_name,
            parent.id AS parent_id, parent.name AS parent_name
     FROM category_suggestions cs
     JOIN categories leaf   ON cs.leaf_id           = leaf.id
     JOIN categories parent ON cs.suggested_parent_id = parent.id
     WHERE cs.household_id = $1 AND cs.status = 'pending'
     ORDER BY cs.created_at`,
    [householdId]
  );
  return result.rows.map(r => ({
    id: r.id,
    leaf:             { id: r.leaf_id,   name: r.leaf_name },
    suggested_parent: { id: r.parent_id, name: r.parent_name },
  }));
}

// Delete existing pending for this leaf, then insert new one.
async function upsertForLeaf(householdId, leafId, suggestedParentId) {
  await db.query(
    "DELETE FROM category_suggestions WHERE household_id = $1 AND leaf_id = $2 AND status = 'pending'",
    [householdId, leafId]
  );
  await db.query(
    'INSERT INTO category_suggestions (household_id, leaf_id, suggested_parent_id) VALUES ($1, $2, $3)',
    [householdId, leafId, suggestedParentId]
  );
}

// Accept: set status + update leaf's parent_id atomically.
async function accept(id, householdId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE category_suggestions
       SET status = 'accepted'
       WHERE id = $1 AND household_id = $2 AND status = 'pending'
       RETURNING leaf_id, suggested_parent_id`,
      [id, householdId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const { leaf_id, suggested_parent_id } = result.rows[0];
    await client.query('UPDATE categories SET parent_id = $1 WHERE id = $2', [suggested_parent_id, leaf_id]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function reject(id, householdId) {
  const result = await db.query(
    `UPDATE category_suggestions
     SET status = 'rejected'
     WHERE id = $1 AND household_id = $2 AND status = 'pending'
     RETURNING id`,
    [id, householdId]
  );
  return result.rows[0] || null;
}

module.exports = { countPending, getPending, upsertForLeaf, accept, reject };
```

- [ ] **Step 4: Run the tests**

```bash
cd api && npx jest tests/models/categorySuggestion.test.js --no-coverage 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 5: Re-run all categories route tests (now that the model exists)**

```bash
cd api && npx jest tests/routes/categories.test.js --no-coverage 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/models/categorySuggestion.js api/tests/models/categorySuggestion.test.js
git commit -m "feat: CategorySuggestion model — pending suggestions CRUD"
```

---

## Task 4: CategorySuggester Service

**Files:**
- Create: `api/src/services/categorySuggester.js`
- Create: `api/tests/services/categorySuggester.test.js`

- [ ] **Step 1: Write the test file**

```js
// api/tests/services/categorySuggester.test.js
jest.mock('../../src/services/ai');
const ai = require('../../src/services/ai');
const Category = require('../../src/models/category');
const CategorySuggestion = require('../../src/models/categorySuggestion');
const { suggest } = require('../../src/services/categorySuggester');

const HOUSEHOLD = 'hh-test-suggester';
const PARENT_ID = 'parent-uuid-001';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Category, 'findByHousehold').mockResolvedValue([
    { id: PARENT_ID,    name: 'Food',       parent_id: null, household_id: HOUSEHOLD },
    { id: 'leaf-uuid-1', name: 'Groceries',  parent_id: null, household_id: HOUSEHOLD },
    { id: 'leaf-uuid-2', name: 'Dining Out', parent_id: null, household_id: HOUSEHOLD },
  ]);
  jest.spyOn(CategorySuggestion, 'upsertForLeaf').mockResolvedValue();
});

describe('suggest', () => {
  it('calls AI and stores results for matching leaves', async () => {
    ai.complete.mockResolvedValue(
      '[{"leaf_id":"leaf-uuid-1","parent_id":"parent-uuid-001"},{"leaf_id":"leaf-uuid-2","parent_id":"parent-uuid-001"}]'
    );

    await suggest(HOUSEHOLD, PARENT_ID);

    expect(ai.complete).toHaveBeenCalledTimes(1);
    const call = ai.complete.mock.calls[0][0];
    expect(call.messages[0].content).toContain('Groceries');
    expect(call.messages[0].content).toContain('Dining Out');

    expect(CategorySuggestion.upsertForLeaf).toHaveBeenCalledWith(HOUSEHOLD, 'leaf-uuid-1', PARENT_ID);
    expect(CategorySuggestion.upsertForLeaf).toHaveBeenCalledWith(HOUSEHOLD, 'leaf-uuid-2', PARENT_ID);
  });

  it('does nothing when no unassigned leaves exist', async () => {
    jest.spyOn(Category, 'findByHousehold').mockResolvedValue([
      { id: PARENT_ID, name: 'Food', parent_id: null, household_id: HOUSEHOLD },
    ]);

    await suggest(HOUSEHOLD, PARENT_ID);

    expect(ai.complete).not.toHaveBeenCalled();
    expect(CategorySuggestion.upsertForLeaf).not.toHaveBeenCalled();
  });

  it('is non-fatal — resolves even if AI throws', async () => {
    ai.complete.mockRejectedValue(new Error('AI down'));
    await expect(suggest(HOUSEHOLD, PARENT_ID)).resolves.toBeUndefined();
  });

  it('is non-fatal — resolves even if JSON is unparseable', async () => {
    ai.complete.mockResolvedValue('not valid json');
    await expect(suggest(HOUSEHOLD, PARENT_ID)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd api && npx jest tests/services/categorySuggester.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../src/services/categorySuggester'`

- [ ] **Step 3: Create `api/src/services/categorySuggester.js`**

```js
const ai = require('./ai');
const Category = require('../models/category');
const CategorySuggestion = require('../models/categorySuggestion');

const SYSTEM_PROMPT = `You are a personal finance category organizer.
Given a new parent category and a list of existing categories, return which existing categories should be grouped under the parent.
Respond ONLY with a valid JSON array of objects: [{"leaf_id":"...","parent_id":"..."}].
Return [] if no categories are a good match.
Be conservative — only suggest categories that clearly belong under the parent.`;

async function suggest(householdId, newParentId) {
  try {
    const all = await Category.findByHousehold(householdId);

    // Unassigned household-owned categories, excluding the new parent itself
    const leaves = all.filter(
      c => c.household_id === householdId && !c.parent_id && c.id !== newParentId
    );
    if (leaves.length === 0) return;

    const parent = all.find(c => c.id === newParentId);
    if (!parent) return;

    const leafList = leaves.map(c => `- ${c.id}: ${c.name}`).join('\n');
    const userMessage = `New parent category: "${parent.name}" (id: ${newParentId})\n\nExisting categories to consider:\n${leafList}\n\nWhich of these belong under "${parent.name}"?`;

    const responseText = await ai.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 256,
    });

    if (!responseText) return;

    // Strip markdown code fences if present
    const clean = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const suggestions = JSON.parse(clean);

    for (const s of suggestions) {
      if (s.leaf_id && s.parent_id) {
        await CategorySuggestion.upsertForLeaf(householdId, s.leaf_id, s.parent_id);
      }
    }
  } catch {
    // Non-fatal — failure here must never block the categories route
  }
}

module.exports = { suggest };
```

- [ ] **Step 4: Run the tests**

```bash
cd api && npx jest tests/services/categorySuggester.test.js --no-coverage 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/categorySuggester.js api/tests/services/categorySuggester.test.js
git commit -m "feat: categorySuggester service — AI-powered leaf-to-parent mapping"
```

---

## Task 5: Categories Route — Suggestion Endpoints

The route file was already written in Task 2 (it imports `CategorySuggestion` and `categorySuggester`). This task verifies those endpoints work end-to-end with tests.

**Files:**
- Modify: `api/tests/routes/categories.test.js`

- [ ] **Step 1: Add suggestion route tests**

Append to `api/tests/routes/categories.test.js`:

```js
describe('GET /categories/suggestions', () => {
  it('returns an array (possibly empty)', async () => {
    const res = await request(app).get('/categories/suggestions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('suggestion accept/reject', () => {
  let parentId, leafId, suggestionId;

  beforeEach(async () => {
    const p = await request(app).post('/categories').send({ name: 'AcceptParent' });
    const l = await request(app).post('/categories').send({ name: 'AcceptLeaf' });
    parentId = p.body.id;
    leafId   = l.body.id;

    // Directly insert a suggestion into the DB
    const db = require('../../src/db');
    const userRes = await db.query("SELECT household_id FROM users WHERE auth0_id = 'auth0|test-user-123'");
    const householdId = userRes.rows[0]?.household_id;
    const res = await db.query(
      'INSERT INTO category_suggestions (household_id, leaf_id, suggested_parent_id) VALUES ($1,$2,$3) RETURNING id',
      [householdId, leafId, parentId]
    );
    suggestionId = res.rows[0].id;
  });

  afterEach(async () => {
    const db = require('../../src/db');
    await db.query('DELETE FROM category_suggestions WHERE id = $1', [suggestionId]).catch(() => {});
    await request(app).delete(`/categories/${leafId}`).catch(() => {});
    await request(app).delete(`/categories/${parentId}`).catch(() => {});
  });

  it('POST /categories/suggestions/:id/accept returns ok and updates parent_id', async () => {
    const res = await request(app).post(`/categories/suggestions/${suggestionId}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /categories/suggestions/:id/reject returns ok', async () => {
    const res = await request(app).post(`/categories/suggestions/${suggestionId}/reject`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('accept on already-rejected returns 404', async () => {
    await request(app).post(`/categories/suggestions/${suggestionId}/reject`);
    const res = await request(app).post(`/categories/suggestions/${suggestionId}/accept`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd api && npx jest tests/routes/categories.test.js --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add api/tests/routes/categories.test.js
git commit -m "test: category suggestion accept/reject route tests"
```

---

## Task 6: Budget Route — Per-Parent Rollup

**Files:**
- Modify: `api/src/routes/budgets.js`
- Modify: `api/tests/routes/budgets.test.js`

The `GET /budgets` response gains a `by_parent` array. Each entry: `{ group_id, name, spent, limit, remaining }`.

- [ ] **Step 1: Add a failing test**

Read `api/tests/routes/budgets.test.js` first to understand setup, then append:

```js
describe('GET /budgets by_parent', () => {
  it('includes a by_parent array in response', async () => {
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('by_parent');
    expect(Array.isArray(res.body.by_parent)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd api && npx jest tests/routes/budgets.test.js --no-coverage 2>&1 | tail -10
```

Expected: `by_parent` assertion fails.

- [ ] **Step 3: Update `api/src/routes/budgets.js` GET handler**

Replace the GET `/` handler (lines 18–63) with:

```js
router.get('/', async (req, res, next) => {
  try {
    const user = await requireHousehold(req, res);
    if (!user) return;

    const thisMonth = new Date().toISOString().slice(0, 7);
    const settings = await BudgetSetting.findByHousehold(user.household_id);

    // Per-category spending (existing)
    const spendResult = await db.query(
      `SELECT category_id, SUM(amount) as spent
       FROM expenses
       WHERE household_id = $1
         AND status = 'confirmed'
         AND to_char(date, 'YYYY-MM') = $2
       GROUP BY category_id`,
      [user.household_id, thisMonth]
    );
    const spendByCategory = {};
    for (const row of spendResult.rows) {
      spendByCategory[row.category_id || '__total__'] = Number(row.spent);
    }
    const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

    // Per-parent spending (new): group leaf expenses under their parent
    const parentSpendResult = await db.query(
      `SELECT COALESCE(c.parent_id, e.category_id) AS group_id, SUM(e.amount) AS spent
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.household_id = $1
         AND e.status = 'confirmed'
         AND to_char(e.date, 'YYYY-MM') = $2
       GROUP BY group_id`,
      [user.household_id, thisMonth]
    );

    // Look up names for the group IDs
    const groupIds = parentSpendResult.rows
      .map(r => r.group_id)
      .filter(Boolean);
    const catNames = {};
    if (groupIds.length > 0) {
      const catRes = await db.query(
        'SELECT id, name FROM categories WHERE id = ANY($1)',
        [groupIds]
      );
      for (const row of catRes.rows) catNames[row.id] = row.name;
    }

    const by_parent = parentSpendResult.rows
      .filter(r => r.group_id)
      .map(r => {
        const spent = Number(r.spent);
        const setting = settings.find(s => s.category_id === r.group_id);
        const limit = setting ? Number(setting.monthly_limit) : null;
        return {
          group_id: r.group_id,
          name: catNames[r.group_id] || 'Unknown',
          spent,
          limit,
          remaining: limit !== null ? limit - spent : null,
        };
      });

    const totalSetting = settings.find(s => s.category_id === null);
    const categorySummaries = settings
      .filter(s => s.category_id !== null)
      .map(s => {
        const spent = spendByCategory[s.category_id] || 0;
        return {
          id: s.category_id,
          limit: Number(s.monthly_limit),
          spent,
          remaining: Number(s.monthly_limit) - spent,
        };
      });

    res.json({
      total: totalSetting
        ? { limit: Number(totalSetting.monthly_limit), spent: totalSpent, remaining: Number(totalSetting.monthly_limit) - totalSpent }
        : null,
      categories: categorySummaries,
      by_parent,
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Run tests**

```bash
cd api && npx jest tests/routes/budgets.test.js --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/budgets.js api/tests/routes/budgets.test.js
git commit -m "feat: GET /budgets — add by_parent rollup using COALESCE(parent_id, category_id)"
```

---

## Task 7: Expense Model — category_parent_name

**Files:**
- Modify: `api/src/models/expense.js`

Three queries need a second LEFT JOIN to surface `category_parent_name`: `findByUser` (line 13), `findById` (line 76), `findByHousehold` (line 88).

- [ ] **Step 1: Update `findByUser`**

Current SELECT in `findByUser` (lines 14–21):
```sql
SELECT e.*,
       c.name as category_name, c.icon as category_icon, c.color as category_color,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
```

Replace with:
```sql
SELECT e.*,
       c.name  AS category_name,
       c.icon  AS category_icon,
       c.color AS category_color,
       pc.name AS category_parent_name,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
FROM expenses e
LEFT JOIN categories  c  ON e.category_id = c.id
LEFT JOIN categories  pc ON c.parent_id   = pc.id
```

- [ ] **Step 2: Update `findById`**

Current SELECT in `findById` (lines 77–82):
```sql
SELECT e.*,
       c.name as category_name, c.icon as category_icon, c.color as category_color,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
```

Replace with:
```sql
SELECT e.*,
       c.name  AS category_name,
       c.icon  AS category_icon,
       c.color AS category_color,
       pc.name AS category_parent_name,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
FROM expenses e
LEFT JOIN categories  c  ON e.category_id = c.id
LEFT JOIN categories  pc ON c.parent_id   = pc.id
```

- [ ] **Step 3: Update `findByHousehold`**

Current SELECT in `findByHousehold` (lines 95–101):
```sql
SELECT e.*,
       c.name as category_name, c.icon as category_icon, c.color as category_color,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count,
       u.name as user_name
FROM expenses e
LEFT JOIN categories c ON e.category_id = c.id
LEFT JOIN users u ON e.user_id = u.id
```

Replace with:
```sql
SELECT e.*,
       c.name  AS category_name,
       c.icon  AS category_icon,
       c.color AS category_color,
       pc.name AS category_parent_name,
       (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count,
       u.name  AS user_name
FROM expenses e
LEFT JOIN categories  c  ON e.category_id = c.id
LEFT JOIN categories  pc ON c.parent_id   = pc.id
LEFT JOIN users       u  ON e.user_id     = u.id
```

- [ ] **Step 4: Verify the expense tests still pass**

```bash
cd api && npx jest tests/routes/expenses.test.js --no-coverage 2>&1 | tail -10
```

Expected: all pass (new field is additive).

- [ ] **Step 5: Commit**

```bash
git add api/src/models/expense.js
git commit -m "feat: expense queries — add category_parent_name via second LEFT JOIN"
```

---

## Task 8: Mobile — Categories Page Redesign

**Files:**
- Rewrite: `mobile/app/categories.js`
- Modify: `mobile/app/(tabs)/settings.js`

### categories.js complete rewrite

The page now:
1. Loads `{ categories, pending_suggestions_count }` from `GET /categories`
2. If count > 0, loads `GET /categories/suggestions`
3. Shows a dismissible suggestions card at top
4. Groups custom categories: parent sections with indented children, then an "Ungrouped" section
5. Adds a parent picker to the "Add" form

- [ ] **Step 1: Rewrite `mobile/app/categories.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../services/api';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newCatName, setNewCatName] = useState('');
  const [newCatParentId, setNewCatParentId] = useState(null);
  const [addingCat, setAddingCat] = useState(false);

  const [editingCatId, setEditingCatId] = useState(null);
  const [editingCatName, setEditingCatName] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/categories');
      setCategories(data.categories || []);
      const count = data.pending_suggestions_count || 0;
      setPendingCount(count);
      if (count > 0) {
        const s = await api.get('/categories/suggestions');
        setSuggestions(s);
      } else {
        setSuggestions([]);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addCategory() {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const body = { name: newCatName.trim() };
      if (newCatParentId) body.parent_id = newCatParentId;
      await api.post('/categories', body);
      setNewCatName('');
      setNewCatParentId(null);
      load();
    } catch { /* ignore */ } finally {
      setAddingCat(false);
    }
  }

  async function saveCategory(id) {
    if (!editingCatName.trim()) return;
    try {
      await api.patch(`/categories/${id}`, { name: editingCatName.trim() });
      setEditingCatId(null);
      load();
    } catch { /* ignore */ }
  }

  async function deleteCategory(id, name) {
    Alert.alert('Delete category', `Delete "${name}"? Expenses won't lose their category.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api.delete(`/categories/${id}`); load(); }
          catch { /* ignore */ }
        },
      },
    ]);
  }

  async function acceptSuggestion(id) {
    try {
      await api.post(`/categories/suggestions/${id}/accept`);
      load();
    } catch { /* ignore */ }
  }

  async function rejectSuggestion(id) {
    try {
      await api.post(`/categories/suggestions/${id}/reject`);
      load();
    } catch { /* ignore */ }
  }

  const custom = categories.filter(c => c.household_id !== null);
  const defaults = categories.filter(c => c.household_id === null);

  // Which IDs are referenced as parent_id by at least one custom category
  const referencedParentIds = new Set(custom.filter(c => c.parent_id).map(c => c.parent_id));
  const parentCats = custom.filter(c => !c.parent_id && referencedParentIds.has(c.id));
  const childrenByParent = {};
  for (const cat of custom.filter(c => c.parent_id)) {
    if (!childrenByParent[cat.parent_id]) childrenByParent[cat.parent_id] = [];
    childrenByParent[cat.parent_id].push(cat);
  }
  const ungrouped = custom.filter(c => !c.parent_id && !referencedParentIds.has(c.id));

  // Only show parent chips if there are parent-level categories with no parent_id
  const parentOptions = custom.filter(c => !c.parent_id);

  function renderCatRow(cat, indented = false) {
    return (
      <View key={cat.id} style={[styles.row, indented && styles.rowIndented]}>
        {editingCatId === cat.id ? (
          <TextInput
            style={[styles.editInput, { flex: 1 }]}
            value={editingCatName}
            onChangeText={setEditingCatName}
            autoFocus
            onSubmitEditing={() => saveCategory(cat.id)}
            returnKeyType="done"
          />
        ) : (
          <Text style={styles.catName}>{cat.name}</Text>
        )}
        <View style={styles.actions}>
          {editingCatId === cat.id ? (
            <>
              <TouchableOpacity onPress={() => saveCategory(cat.id)}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingCatId(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }}>
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteCategory(cat.id, cat.name)}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Category Details' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color="#555" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Suggestions card */}
            {pendingCount > 0 && !dismissed && (
              <View style={styles.suggestCard}>
                <View style={styles.suggestHeader}>
                  <Text style={styles.suggestTitle}>Suggested groupings</Text>
                  <TouchableOpacity onPress={() => setDismissed(true)}>
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
                {suggestions.map(s => (
                  <View key={s.id} style={styles.suggestRow}>
                    <Text style={styles.suggestLabel}>
                      {s.leaf.name} → {s.suggested_parent.name}
                    </Text>
                    <View style={styles.suggestActions}>
                      <TouchableOpacity onPress={() => acceptSuggestion(s.id)}>
                        <Text style={styles.acceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => rejectSuggestion(s.id)}>
                        <Text style={styles.rejectText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Grouped custom categories */}
            <Text style={styles.sectionLabel}>CUSTOM</Text>
            {custom.length === 0 && <Text style={styles.empty}>No custom categories yet.</Text>}

            {/* Parent sections */}
            {parentCats.map(parent => (
              <View key={parent.id}>
                <View style={styles.parentHeader}>
                  <Text style={styles.parentLabel}>{parent.name}</Text>
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => { setEditingCatId(parent.id); setEditingCatName(parent.name); }}>
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteCategory(parent.id, parent.name)}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {(childrenByParent[parent.id] || []).map(child => renderCatRow(child, true))}
              </View>
            ))}

            {/* Ungrouped */}
            {ungrouped.length > 0 && (
              <View style={styles.ungroupedSection}>
                <Text style={styles.ungroupedLabel}>Ungrouped</Text>
                {ungrouped.map(cat => renderCatRow(cat, false))}
              </View>
            )}

            {/* Add new */}
            <View style={styles.addSection}>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.editInput, { flex: 1 }]}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  placeholder="New category name"
                  placeholderTextColor="#444"
                  onSubmitEditing={addCategory}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addBtn, (!newCatName.trim() || addingCat) && styles.addBtnDisabled]}
                  onPress={addCategory}
                  disabled={!newCatName.trim() || addingCat}
                >
                  {addingCat
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.addBtnText}>Add</Text>}
                </TouchableOpacity>
              </View>
              {/* Optional parent picker */}
              {parentOptions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.parentPicker}>
                  <TouchableOpacity
                    style={[styles.parentChip, !newCatParentId && styles.parentChipActive]}
                    onPress={() => setNewCatParentId(null)}
                  >
                    <Text style={[styles.parentChipText, !newCatParentId && styles.parentChipTextActive]}>None</Text>
                  </TouchableOpacity>
                  {parentOptions.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.parentChip, newCatParentId === p.id && styles.parentChipActive]}
                      onPress={() => setNewCatParentId(p.id)}
                    >
                      <Text style={[styles.parentChipText, newCatParentId === p.id && styles.parentChipTextActive]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Default categories (read-only) */}
            <Text style={[styles.sectionLabel, { marginTop: 32 }]}>DEFAULTS</Text>
            <Text style={styles.defaultsNote}>Built-in categories shared across all households.</Text>
            {defaults.map(cat => (
              <View key={cat.id} style={[styles.row, { opacity: 0.4 }]}>
                <Text style={styles.catName}>{cat.name}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48 },

  sectionLabel: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  empty: { color: '#444', fontSize: 13, marginBottom: 12 },
  defaultsNote: { color: '#444', fontSize: 12, marginBottom: 10 },

  // Suggestions card
  suggestCard: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#2a2a1a' },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  suggestTitle: { fontSize: 11, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
  dismissText: { fontSize: 12, color: '#555' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  suggestLabel: { flex: 1, color: '#ccc', fontSize: 14 },
  suggestActions: { flexDirection: 'row', gap: 12 },
  acceptText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  rejectText: { color: '#555', fontSize: 13 },

  // Category rows
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#111' },
  rowIndented: { paddingLeft: 16 },
  catName: { flex: 1, fontSize: 15, color: '#f5f5f5' },
  actions: { flexDirection: 'row', gap: 16 },
  editText: { color: '#888', fontSize: 13 },
  deleteText: { color: '#ef4444', fontSize: 13 },
  saveText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  cancelText: { color: '#555', fontSize: 13 },

  // Parent section header
  parentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  parentLabel: { flex: 1, fontSize: 13, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Ungrouped section
  ungroupedSection: { marginTop: 12 },
  ungroupedLabel: { fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },

  // Edit input
  editInput: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#1f1f1f' },

  // Add form
  addSection: { marginTop: 16 },
  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.3 },
  addBtnText: { color: '#000', fontWeight: '600', fontSize: 14 },

  // Parent picker
  parentPicker: { marginTop: 10 },
  parentChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 8 },
  parentChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  parentChipText: { fontSize: 13, color: '#555' },
  parentChipTextActive: { color: '#000', fontWeight: '600' },
});
```

- [ ] **Step 2: Brace-balance check**

```bash
node -e "require('./mobile/app/categories.js')" 2>&1 || \
  node --input-type=module < mobile/app/categories.js 2>&1 | head -5
```

Since this is an ESM file (uses `import`), check with:

```bash
cd /Users/dangnguyen/curious-trio/.claude/worktrees/lucid-faraday && \
  python3 -c "
import re, sys
src = open('mobile/app/categories.js').read()
opens = src.count('{')
closes = src.count('}')
print(f'Open braces: {opens}, Close braces: {closes}')
sys.exit(0 if opens == closes else 1)
"
```

Expected: equal brace counts.

- [ ] **Step 3: Update settings badge in `mobile/app/(tabs)/settings.js`**

Add `pendingSuggestionsCount` state to settings. Replace the `useEffect` and imports section:

Add state and load call after existing state declarations (after line 24, `const [budgetMsg, setBudgetMsg] = useState('');`):

```js
const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);
```

Add this after the `loadBudget` `useEffect` (after line 34):

```js
useEffect(() => {
  api.get('/categories')
    .then(d => setPendingSuggestionsCount(d.pending_suggestions_count || 0))
    .catch(() => {});
}, []);
```

Replace the Categories `<TouchableOpacity>` row (lines 63–66):

```jsx
<TouchableOpacity style={styles.navRow} onPress={() => router.push('/categories')}>
  <Text style={styles.navRowText}>Edit category details</Text>
  <View style={styles.navRowRight}>
    {pendingSuggestionsCount > 0 && <View style={styles.badge} />}
    <Ionicons name="chevron-forward" size={16} color="#444" />
  </View>
</TouchableOpacity>
```

Add to StyleSheet (before the closing `}`):

```js
navRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
badge: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
```

- [ ] **Step 4: Brace-balance check settings.js**

```bash
cd /Users/dangnguyen/curious-trio/.claude/worktrees/lucid-faraday && \
  python3 -c "
src = open('mobile/app/(tabs)/settings.js').read()
print(f'Open: {src.count(\"{\")}, Close: {src.count(\"}\")}')"
```

Expected: equal counts.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/categories.js mobile/app/(tabs)/settings.js
git commit -m "feat: categories page — grouped hierarchy, suggestions card, settings badge"
```

---

## Task 9: Mobile — ExpenseItem parent name

**Files:**
- Modify: `mobile/components/ExpenseItem.js`

The meta row shows `category_parent_name` when available; falls back to `category_name`.

- [ ] **Step 1: Update `mobile/components/ExpenseItem.js`**

On line 33, replace:
```js
const color = categoryColor(expense.category_name);
```
with:
```js
const displayCategory = expense.category_parent_name || expense.category_name;
const color = categoryColor(displayCategory);
```

On line 63–65, replace:
```jsx
<View style={[styles.dot, { backgroundColor: color }]} />
<Text style={styles.meta}>
  {expense.category_name || 'Uncategorized'}
```
with:
```jsx
<View style={[styles.dot, { backgroundColor: color }]} />
<Text style={styles.meta}>
  {displayCategory || 'Uncategorized'}
```

- [ ] **Step 2: Brace-balance check**

```bash
cd /Users/dangnguyen/curious-trio/.claude/worktrees/lucid-faraday && \
  python3 -c "
src = open('mobile/components/ExpenseItem.js').read()
print(f'Open: {src.count(\"{\")}, Close: {src.count(\"}\")}')"
```

Expected: equal counts.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/ExpenseItem.js
git commit -m "feat: ExpenseItem — show parent category name in meta row"
```

---

## Task 10: Mobile — Summary Per-Parent Budget Breakdown

**Files:**
- Modify: `mobile/app/(tabs)/summary.js`

The `useBudget` hook already fetches `/budgets`. The response now includes `by_parent`. Add a breakdown section below the household card showing each group with optional mini progress bar.

- [ ] **Step 1: Update `mobile/app/(tabs)/summary.js`**

After the existing `showHousehold` variable (line 46), add:

```js
const byParent = budget?.by_parent || [];
const showParentBreakdown = byParent.length > 0;
```

After the household card closing `</View>` (after line 126), add the per-parent breakdown block:

```jsx
{/* Per-parent category breakdown */}
{showParentBreakdown && (
  <View style={styles.parentBreakdown}>
    <Text style={styles.sectionLabel}>BY CATEGORY</Text>
    {byParent.map(group => {
      const pct = group.limit ? Math.min(group.spent / group.limit, 1) : null;
      const over = group.limit && group.spent > group.limit;
      return (
        <View key={group.group_id} style={styles.parentRow}>
          <View style={styles.parentRowTop}>
            <Text style={styles.parentRowName} numberOfLines={1}>{group.name}</Text>
            <Text style={[styles.parentRowSpent, over && styles.parentRowOver]}>
              ${Math.round(group.spent)}
              {group.limit ? ` / $${Math.round(group.limit)}` : ''}
            </Text>
          </View>
          {pct !== null && (
            <View style={styles.parentBarTrack}>
              <View style={[styles.parentBarFill, { width: `${pct * 100}%`, backgroundColor: over ? '#ef4444' : '#4ade80' }]} />
            </View>
          )}
        </View>
      );
    })}
  </View>
)}
```

Add to `StyleSheet.create({...})` (before the closing `}`):

```js
parentBreakdown: { marginBottom: 32 },
parentRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
parentRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
parentRowName: { flex: 1, fontSize: 13, color: '#aaa', marginRight: 8 },
parentRowSpent: { fontSize: 13, color: '#f5f5f5', fontWeight: '500' },
parentRowOver: { color: '#ef4444' },
parentBarTrack: { height: 2, backgroundColor: '#1f1f1f', borderRadius: 1 },
parentBarFill: { height: 2, borderRadius: 1 },
```

- [ ] **Step 2: Brace-balance check**

```bash
cd /Users/dangnguyen/curious-trio/.claude/worktrees/lucid-faraday && \
  python3 -c "
src = open('mobile/app/(tabs)/summary.js').read()
print(f'Open: {src.count(\"{\")}, Close: {src.count(\"}\")}')"
```

Expected: equal counts.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(tabs)/summary.js
git commit -m "feat: summary tab — per-parent budget breakdown from by_parent rollup"
```

---

## Final Verification

- [ ] **Run full API test suite**

```bash
cd api && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Restart API server to pick up model changes**

```bash
# Kill existing node process if running, then:
cd /Users/dangnguyen/curious-trio/.claude/worktrees/lucid-faraday/api && node src/index.js
```

- [ ] **Manual smoke test checklist**
  - `GET /categories` returns `{ categories: [...], pending_suggestions_count: N }`
  - `POST /categories` with no `parent_id` triggers background suggestions (check DB: `SELECT * FROM category_suggestions`)
  - `GET /categories/suggestions` returns pending suggestions
  - Accept a suggestion → leaf `parent_id` updates in DB
  - `GET /budgets` returns `by_parent` array
  - Expense list items show parent name in meta row
  - Summary tab shows by-category breakdown
  - Settings Categories row shows red dot when suggestions pending
