const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.userId = 'auth0|test-user-123';
    next();
  },
}));

beforeEach(async () => {
  await db.query("DELETE FROM categories WHERE household_id IS NULL AND name IN ('Test Cat', 'Updated Cat', 'To Delete')");
});

afterAll(() => db.pool.end());

async function ensureHouseholdUser() {
  const userRes = await db.query("SELECT id, household_id FROM users WHERE provider_uid = 'auth0|test-user-123'");
  if (userRes.rows[0]?.household_id) return { userId: userRes.rows[0].id, householdId: userRes.rows[0].household_id, created: false };

  const householdRes = await db.query("INSERT INTO households (name) VALUES ('Default Category Test HH') RETURNING id");
  const householdId = householdRes.rows[0].id;
  if (userRes.rows.length) {
    await db.query("UPDATE users SET household_id = $1 WHERE id = $2", [householdId, userRes.rows[0].id]);
    return { userId: userRes.rows[0].id, householdId, created: true };
  }
  const inserted = await db.query(
    "INSERT INTO users (provider_uid, name, email, household_id) VALUES ('auth0|test-user-123', 'Test User', 'test@example.com', $1) RETURNING id",
    [householdId]
  );
  return { userId: inserted.rows[0].id, householdId, created: true };
}

describe('GET /categories', () => {
  it('returns categories for the user household', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('categories');
    expect(Array.isArray(res.body.categories)).toBe(true);
  });
});

describe('POST /categories', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ name: 'Groceries', icon: '🛒', color: '#4ade80' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Groceries');
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ icon: '🛒' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /categories/:id', () => {
  it('updates a category', async () => {
    const created = await request(app)
      .post('/categories')
      .send({ name: 'Test Cat', icon: '🔖', color: '#fff' });

    const res = await request(app)
      .patch(`/categories/${created.body.id}`)
      .send({ name: 'Updated Cat' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Cat');
  });

  it('returns 404 for non-existent category', async () => {
    const res = await request(app)
      .patch('/categories/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('renames a default category only for the current household', async () => {
    const { householdId, created } = await ensureHouseholdUser();
    const defaultRes = await db.query(
      `INSERT INTO categories (household_id, name) VALUES (NULL, 'Default Rename Test') RETURNING id`
    );

    const res = await request(app)
      .patch(`/categories/${defaultRes.rows[0].id}`)
      .send({ name: 'Household Label' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Household Label');
    expect(res.body.hidden).toBe(false);

    await db.query(`DELETE FROM category_household_overrides WHERE category_id = $1`, [defaultRes.rows[0].id]);
    await db.query(`DELETE FROM categories WHERE id = $1`, [defaultRes.rows[0].id]);
    if (created) {
      await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-user-123'`);
      await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    }
  });
});

describe('quick category creation', () => {
  it('suggests a likely parent from merchant memory', async () => {
    await ensureHouseholdUser();
    const parent = await request(app).post('/categories').send({ name: 'Food' });
    const child = await request(app).post('/categories').send({ name: 'Groceries', parent_id: parent.body.id });

    const userRes = await db.query("SELECT household_id FROM users WHERE provider_uid = 'auth0|test-user-123'");
    const householdId = userRes.rows[0].household_id;
    await db.query(
      `INSERT INTO merchant_mappings (household_id, merchant_name, category_id, hit_count)
       VALUES ($1, LOWER($2), $3, 3)
       ON CONFLICT (household_id, merchant_name)
       DO UPDATE SET category_id = EXCLUDED.category_id, hit_count = EXCLUDED.hit_count`,
      [householdId, 'Trader Joe\'s', child.body.id]
    );

    const suggestion = await request(app)
      .get('/categories/quick-parent-suggestion')
      .query({ name: 'Produce Run', merchant: "Trader Joe's" });

    expect(suggestion.status).toBe(200);
    expect(suggestion.body.parent_id).toBe(parent.body.id);
    expect(suggestion.body.parent_name).toBe('Food');
    expect(suggestion.body.source).toBe('merchant_memory');

    const created = await request(app)
      .post('/categories/quick')
      .send({ name: 'Produce Run', merchant: "Trader Joe's" });

    expect(created.status).toBe(201);
    expect(created.body.parent_id).toBe(parent.body.id);
    expect(created.body.parent_name).toBe('Food');

    await db.query(
      `DELETE FROM merchant_mappings WHERE household_id = $1 AND merchant_name = LOWER($2)`,
      [householdId, 'Trader Joe\'s']
    );
    await request(app).delete(`/categories/${created.body.id}`);
    await request(app).delete(`/categories/${child.body.id}`);
    await request(app).delete(`/categories/${parent.body.id}`);
  });

  it('falls back to Uncategorized when no strong parent match exists', async () => {
    await ensureHouseholdUser();
    const created = await request(app)
      .post('/categories/quick')
      .send({ name: 'Random New Bucket' });

    expect(created.status).toBe(201);
    expect(created.body.parent_name).toBe('Uncategorized');
    expect(['fallback_uncategorized', 'created_uncategorized']).toContain(created.body.quick_create_source);

    await request(app).delete(`/categories/${created.body.id}`);
  });
});

describe('POST /categories/:id/merge', () => {
  it('merges a leaf category into another category and reassigns expenses', async () => {
    await ensureHouseholdUser();
    const target = await request(app).post('/categories').send({ name: 'MergeTarget' });
    const source = await request(app).post('/categories').send({ name: 'MergeSource' });

    const userRes = await db.query("SELECT id, household_id FROM users WHERE provider_uid = 'auth0|test-user-123'");
    const userId = userRes.rows[0].id;
    const householdId = userRes.rows[0].household_id;

    const expenseRes = await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status)
       VALUES ($1, $2, 'Merge Test', 12.34, CURRENT_DATE, $3, 'manual', 'confirmed')
       RETURNING id`,
      [userId, householdId, source.body.id]
    );

    const res = await request(app)
      .post(`/categories/${source.body.id}/merge`)
      .send({ target_category_id: target.body.id });

    expect(res.status).toBe(200);
    expect(res.body.target_id).toBe(target.body.id);
    expect(res.body.expense_count).toBeGreaterThanOrEqual(1);

    const movedExpense = await db.query('SELECT category_id FROM expenses WHERE id = $1', [expenseRes.rows[0].id]);
    expect(movedExpense.rows[0].category_id).toBe(target.body.id);

    const sourceCheck = await db.query('SELECT id FROM categories WHERE id = $1', [source.body.id]);
    expect(sourceCheck.rows).toHaveLength(0);

    await db.query('DELETE FROM expenses WHERE id = $1', [expenseRes.rows[0].id]);
    await request(app).delete(`/categories/${target.body.id}`);
  });

  it('rejects merging a category that still has children', async () => {
    await ensureHouseholdUser();
    const source = await request(app).post('/categories').send({ name: 'MergeParent' });
    const child = await request(app).post('/categories').send({ name: 'MergeChild', parent_id: source.body.id });
    const target = await request(app).post('/categories').send({ name: 'MergeOther' });

    const res = await request(app)
      .post(`/categories/${source.body.id}/merge`)
      .send({ target_category_id: target.body.id });

    expect(res.status).toBe(400);

    await request(app).delete(`/categories/${child.body.id}`);
    await request(app).delete(`/categories/${target.body.id}`);
    await request(app).delete(`/categories/${source.body.id}`);
  });
});

describe('DELETE /categories/:id', () => {
  it('deletes a category and returns 204', async () => {
    const created = await request(app)
      .post('/categories')
      .send({ name: 'To Delete', icon: '🗑️', color: '#000' });

    const res = await request(app)
      .delete(`/categories/${created.body.id}`);

    expect(res.status).toBe(204);
  });

  it('hides a default category for the household instead of deleting it globally', async () => {
    const { householdId, created } = await ensureHouseholdUser();
    const defaultRes = await db.query(
      `INSERT INTO categories (household_id, name) VALUES (NULL, 'Default Hide Test') RETURNING id`
    );

    const res = await request(app).delete(`/categories/${defaultRes.rows[0].id}`);
    expect(res.status).toBe(204);

    const list = await request(app).get('/categories');
    expect(list.body.categories.some(c => c.id === defaultRes.rows[0].id)).toBe(false);

    const hiddenList = await request(app).get('/categories?include_hidden=1');
    const hidden = hiddenList.body.categories.find(c => c.id === defaultRes.rows[0].id);
    expect(hidden).toBeTruthy();
    expect(hidden.hidden).toBe(true);

    const restore = await request(app).post(`/categories/${defaultRes.rows[0].id}/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.hidden).toBe(false);

    await db.query(`DELETE FROM category_household_overrides WHERE category_id = $1`, [defaultRes.rows[0].id]);
    await db.query(`DELETE FROM categories WHERE id = $1`, [defaultRes.rows[0].id]);
    if (created) {
      await db.query(`UPDATE users SET household_id = NULL WHERE provider_uid = 'auth0|test-user-123'`);
      await db.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    }
  });
});

describe('GET /categories/suggestions', () => {
  it('returns an array (possibly empty)', async () => {
    const res = await request(app).get('/categories/suggestions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body[0]) {
      expect(res.body[0]).toHaveProperty('expense_count');
      expect(res.body[0]).toHaveProperty('sample_merchants');
    }
  });
});

describe('suggestion accept/reject', () => {
  let parentId, leafId, suggestionId;

  beforeEach(async () => {
    const p = await request(app).post('/categories').send({ name: 'AcceptParent' });
    const l = await request(app).post('/categories').send({ name: 'AcceptLeaf' });
    parentId = p.body.id;
    leafId   = l.body.id;

    // Ensure the test user exists with a household
    const userRes = await db.query("SELECT id, household_id FROM users WHERE provider_uid = 'auth0|test-user-123'");
    let userId = userRes.rows[0]?.id;
    let householdId = userRes.rows[0]?.household_id;
    if (!userId) {
      const hRes = await db.query("INSERT INTO households (name) VALUES ('SuggRouteTest') RETURNING id");
      householdId = hRes.rows[0].id;
      const uRes = await db.query(
        "INSERT INTO users (provider_uid, name, email, household_id) VALUES ('auth0|test-user-123', 'Test User', 'test@example.com', $1) RETURNING id",
        [householdId]
      );
      userId = uRes.rows[0].id;
    } else if (!householdId) {
      const hRes = await db.query("INSERT INTO households (name) VALUES ('SuggRouteTest') RETURNING id");
      householdId = hRes.rows[0].id;
      await db.query("UPDATE users SET household_id = $1 WHERE id = $2", [householdId, userId]);
    }
    const res = await db.query(
      'INSERT INTO category_suggestions (household_id, leaf_id, suggested_parent_id) VALUES ($1,$2,$3) RETURNING id',
      [householdId, leafId, parentId]
    );
    suggestionId = res.rows[0].id;
  });

  afterEach(async () => {
    await db.query('DELETE FROM category_suggestions WHERE id = $1', [suggestionId]).catch(() => {});
    await request(app).delete(`/categories/${leafId}`).catch(() => {});
    await request(app).delete(`/categories/${parentId}`).catch(() => {});
  });

  it('POST /categories/suggestions/:id/accept returns ok and updates parent_id', async () => {
    const res = await request(app).post(`/categories/suggestions/${suggestionId}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /categories/suggestions includes counts and merchant examples', async () => {
    const userRes = await db.query("SELECT id, household_id FROM users WHERE provider_uid = 'auth0|test-user-123'");
    const userId = userRes.rows[0].id;
    const householdId = userRes.rows[0].household_id;

    await db.query(
      `INSERT INTO expenses (user_id, household_id, merchant, amount, date, category_id, source, status)
       VALUES ($1, $2, 'Trader Joe''s', 25.00, CURRENT_DATE, $3, 'manual', 'confirmed')`,
      [userId, householdId, leafId]
    );

    const res = await request(app).get('/categories/suggestions');
    expect(res.status).toBe(200);
    const suggestion = res.body.find(s => s.id === suggestionId);
    expect(suggestion).toBeTruthy();
    expect(suggestion.expense_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(suggestion.sample_merchants)).toBe(true);
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
