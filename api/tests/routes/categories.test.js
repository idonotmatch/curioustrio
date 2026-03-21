const request = require('supertest');
const app = require('../../src/index');
const db = require('../../src/db');

jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.auth0Id = 'auth0|test-user-123';
    next();
  },
}));

beforeEach(async () => {
  await db.query("DELETE FROM categories WHERE household_id IS NULL AND name IN ('Test Cat', 'Updated Cat', 'To Delete')");
});

afterAll(() => db.pool.end());

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
