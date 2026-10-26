const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const {
  addAlias,
  getExpenseIdentityContext,
  mergeIdentities,
  markPlaceMoved,
  separateExpenseIdentity,
  updateIdentity,
} = require('../services/identityManagementService');

const router = express.Router();
const DOMAINS = new Set(['merchant', 'payment', 'place']);

router.use(authenticate);

async function getUser(req) {
  const user = await User.findByProviderUid(req.userId);
  if (!user) throw Object.assign(new Error('User not synced. Call POST /users/sync first.'), { status: 401 });
  return user;
}

router.get('/expenses/:id', async (req, res, next) => {
  try {
    res.json(await getExpenseIdentityContext({ user: await getUser(req), expenseId: req.params.id }));
  } catch (error) { next(error); }
});

router.post('/expenses/:id/:domain/separate', async (req, res, next) => {
  try {
    if (!DOMAINS.has(req.params.domain)) return res.status(400).json({ error: 'Invalid identity domain' });
    res.json(await separateExpenseIdentity({ user: await getUser(req), expenseId: req.params.id, domain: req.params.domain }));
  } catch (error) { next(error); }
});

router.patch('/:domain/:id', async (req, res, next) => {
  try {
    if (!DOMAINS.has(req.params.domain)) return res.status(400).json({ error: 'Invalid identity domain' });
    res.json(await updateIdentity({ user: await getUser(req), domain: req.params.domain, entityId: req.params.id, patch: req.body || {} }));
  } catch (error) { next(error); }
});

router.post('/:domain/:id/aliases', async (req, res, next) => {
  try {
    if (!['merchant', 'place'].includes(req.params.domain)) return res.status(400).json({ error: 'Aliases are not supported for this domain' });
    res.status(201).json(await addAlias({ user: await getUser(req), domain: req.params.domain, entityId: req.params.id, alias: req.body?.alias }));
  } catch (error) { next(error); }
});

router.post('/:domain/:id/merge', async (req, res, next) => {
  try {
    if (!DOMAINS.has(req.params.domain)) return res.status(400).json({ error: 'Invalid identity domain' });
    res.json(await mergeIdentities({ user: await getUser(req), domain: req.params.domain, sourceEntityId: req.body?.source_entity_id, targetEntityId: req.params.id }));
  } catch (error) { next(error); }
});

router.post('/place/:id/moved-to', async (req, res, next) => {
  try {
    res.json(await markPlaceMoved({
      user: await getUser(req),
      sourceEntityId: req.params.id,
      targetEntityId: req.body?.target_entity_id,
    }));
  } catch (error) { next(error); }
});

module.exports = router;
