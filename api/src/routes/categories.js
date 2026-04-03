const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../db');
const User = require('../models/user');
const Category = require('../models/category');
const CategorySuggestion = require('../models/categorySuggestion');
const categorySuggester = require('../services/categorySuggester');

router.use(authenticate);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
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

// POST /categories/quick — create a leaf category under "Uncategorized" parent (for inline creation from expense entry)
router.post('/quick', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });

    // Find or create "Uncategorized" parent
    let parent = await db.query(
      `SELECT id FROM categories WHERE household_id = $1 AND name = 'Uncategorized' AND parent_id IS NULL LIMIT 1`,
      [user.household_id]
    );
    if (!parent.rows.length) {
      const created = await Category.create({ householdId: user.household_id, name: 'Uncategorized' });
      parent = { rows: [{ id: created.id }] };
    }

    const category = await Category.create({
      householdId: user.household_id,
      name: name.trim(),
      parentId: parent.rows[0].id,
    });
    res.status(201).json(category);
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
      parentId: parent_id !== undefined ? parent_id : null,
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
    const sortOrder = 'sort_order' in req.body ? req.body.sort_order : undefined;
    if (parentId && parentId === req.params.id) {
      return res.status(400).json({ error: 'A category cannot be its own parent' });
    }
    if (parentId) {
      const user2 = await getUser(req);
      const parentCat = await db.query(
        'SELECT parent_id FROM categories WHERE id = $1 AND (household_id = $2 OR household_id IS NULL)',
        [parentId, user2?.household_id]
      );
      if (!parentCat.rows.length) return res.status(404).json({ error: 'Parent category not found' });
      if (parentCat.rows[0].parent_id) return res.status(400).json({ error: 'Cannot use a child category as a parent' });
    }
    const user = await getUser(req);
    const category = await Category.update({
      id: req.params.id,
      householdId: user?.household_id,
      name,
      icon,
      color,
      parentId,
      sortOrder,
    });
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.json(category);
  } catch (err) { next(err); }
});

router.post('/:id/merge', async (req, res, next) => {
  try {
    const { target_category_id } = req.body;
    if (!target_category_id) return res.status(400).json({ error: 'target_category_id required' });
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'No household' });
    const result = await Category.merge({
      sourceId: req.params.id,
      targetId: target_category_id,
      householdId: user.household_id,
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
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
