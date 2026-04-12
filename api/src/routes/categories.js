const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { perUser } = require('../middleware/rateLimit');
const db = require('../db');
const User = require('../models/user');
const Category = require('../models/category');
const CategorySuggestion = require('../models/categorySuggestion');
const MerchantMapping = require('../models/merchantMapping');
const categorySuggester = require('../services/categorySuggester');

router.use(authenticate);
router.use(perUser);

async function getUser(req) {
  return User.findByProviderUid(req.userId);
}

function normalizeText(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9\s&]/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreTokenOverlap(a = '', b = '') {
  const aTokens = new Set(normalizeText(a).split(' ').filter(t => t.length >= 3));
  const bTokens = new Set(normalizeText(b).split(' ').filter(t => t.length >= 3));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap;
}

function keywordScore(text, keywords) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 1 : 0), 0);
}

function findFallbackParent(categories) {
  return categories.find(c => !c.parent_id && c.name.toLowerCase() === 'uncategorized') || null;
}

function resolveTopLevelCategory(categories, categoryId) {
  const category = categories.find(c => c.id === categoryId);
  if (!category) return null;
  if (!category.parent_id) return category;
  return categories.find(c => c.id === category.parent_id) || null;
}

function rankParentCandidates(categories, text) {
  const parents = categories.filter(c => !c.parent_id);
  const aliasGroups = [
    { keys: ['grocery', 'grocer', 'supermarket', 'market', 'food'], terms: ['grocery', 'grocer', 'supermarket', 'market', 'whole foods', 'trader joe', 'food'] },
    { keys: ['dining', 'restaurant', 'eat', 'food', 'coffee', 'cafe'], terms: ['restaurant', 'dining', 'takeout', 'lunch', 'dinner', 'coffee', 'cafe', 'meal'] },
    { keys: ['travel', 'transport', 'car', 'auto', 'gas', 'commute'], terms: ['uber', 'lyft', 'flight', 'hotel', 'train', 'transit', 'gas', 'parking', 'toll', 'airline'] },
    { keys: ['shopping', 'retail', 'store'], terms: ['amazon', 'shopping', 'retail', 'store', 'apparel', 'clothing'] },
    { keys: ['health', 'medical', 'pharmacy', 'wellness'], terms: ['pharmacy', 'doctor', 'dental', 'medical', 'health'] },
    { keys: ['home', 'housing', 'utilities', 'bills'], terms: ['rent', 'utility', 'electric', 'internet', 'home'] },
    { keys: ['entertainment', 'fun', 'media'], terms: ['movie', 'streaming', 'spotify', 'netflix', 'entertainment'] },
  ];

  return parents
    .map(parent => {
      const parentName = normalizeText(parent.name);
      let score = scoreTokenOverlap(text, parent.name) * 3;
      if (parentName && normalizeText(text).includes(parentName)) score += 4;
      for (const group of aliasGroups) {
        if (group.keys.some(key => parentName.includes(key))) {
          score += keywordScore(text, group.terms);
        }
      }
      return { parent, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function suggestQuickCreateParent({ householdId, name, merchant, description, preferredParentId }) {
  const categories = await Category.findByHousehold(householdId);
  const parents = categories.filter(c => !c.parent_id);
  const fallbackParent = findFallbackParent(categories);

  if (preferredParentId) {
    const explicitParent = parents.find(c => c.id === preferredParentId);
    if (explicitParent) return { parent: explicitParent, source: 'explicit' };
  }

  if (merchant) {
    const mapping = await MerchantMapping.findByMerchant(householdId, merchant);
    if (mapping) {
      const mappedParent = resolveTopLevelCategory(categories, mapping.category_id);
      if (mappedParent) return { parent: mappedParent, source: 'merchant_memory' };
    }
  }

  const categoryLikeText = [name, merchant, description].filter(Boolean).join(' ');
  const siblingMatches = categories
    .filter(c => c.parent_id)
    .map(c => ({
      parent: parents.find(parent => parent.id === c.parent_id) || null,
      score: scoreTokenOverlap(categoryLikeText, c.name),
    }))
    .filter(entry => entry.parent && entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (siblingMatches[0]?.score >= 1) {
    return { parent: siblingMatches[0].parent, source: 'sibling_match' };
  }

  const rankedParents = rankParentCandidates(parents, categoryLikeText);
  if (rankedParents[0]?.score >= 2) {
    return { parent: rankedParents[0].parent, source: 'keyword_match' };
  }

  if (fallbackParent) return { parent: fallbackParent, source: 'fallback_uncategorized' };

  const createdFallback = await Category.create({ householdId, name: 'Uncategorized' });
  return { parent: createdFallback, source: 'created_uncategorized' };
}

// GET /categories — { categories, pending_suggestions_count }
router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const includeHidden = req.query.include_hidden === '1' || req.query.include_hidden === 'true';
    const categories = await Category.findByHousehold(user?.household_id, { includeHidden });
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

// GET /categories/quick-parent-suggestion — preview the likely parent for inline category creation
router.get('/quick-parent-suggestion', async (req, res, next) => {
  try {
    const name = (req.query.name || '').trim();
    const merchant = (req.query.merchant || '').trim();
    const description = (req.query.description || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });

    const { parent, source } = await suggestQuickCreateParent({
      householdId: user.household_id,
      name,
      merchant,
      description,
    });
    res.json({
      parent_id: parent?.id || null,
      parent_name: parent?.name || null,
      source,
    });
  } catch (err) { next(err); }
});

// POST /categories/quick — create a leaf category with a suggested parent (for inline creation from expense entry)
router.post('/quick', async (req, res, next) => {
  try {
    const { name, merchant, description, preferred_parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    if (!user?.household_id) return res.status(403).json({ error: 'Must be in a household' });

    const { parent, source } = await suggestQuickCreateParent({
      householdId: user.household_id,
      name: name.trim(),
      merchant: merchant?.trim(),
      description: description?.trim(),
      preferredParentId: preferred_parent_id || null,
    });

    const category = await Category.create({
      householdId: user.household_id,
      name: name.trim(),
      parentId: parent?.id || null,
    });
    res.status(201).json({
      ...category,
      parent_name: parent?.name || null,
      quick_create_source: source,
    });
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
    const user = await getUser(req);
    const existing = await Category.findAccessibleById(req.params.id, user?.household_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (user?.household_id && existing.is_default) {
      if (parentId !== undefined || icon !== undefined || color !== undefined || sortOrder !== undefined) {
        return res.status(400).json({ error: 'Default categories can only be renamed for your household' });
      }
      if (!name) return res.status(400).json({ error: 'name required' });
      const category = await Category.renameDefaultForHousehold({
        id: req.params.id,
        householdId: user?.household_id,
        displayName: name,
      });
      return res.json(category);
    }
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
    const result = await Category.remove({ id: req.params.id, householdId: user?.household_id });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const category = await Category.findAccessibleById(req.params.id, user?.household_id);
    if (!category || !category.is_default) return res.status(404).json({ error: 'Not found' });
    await Category.restoreDefault({ id: req.params.id, householdId: user?.household_id });
    const restored = await Category.findByHousehold(user?.household_id, { includeHidden: true });
    res.json(restored.find(c => c.id === req.params.id) || null);
  } catch (err) { next(err); }
});

module.exports = router;
