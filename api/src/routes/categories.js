const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Category = require('../models/category');

router.use(authenticate);

async function getUser(req) {
  return User.findByAuth0Id(req.auth0Id);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await getUser(req);
    const categories = await Category.findByHousehold(user?.household_id);
    res.json(categories);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const user = await getUser(req);
    const category = await Category.create({ householdId: user?.household_id, name, icon, color });
    res.status(201).json(category);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, icon, color } = req.body;
    const user = await getUser(req);
    const category = await Category.update({
      id: req.params.id,
      householdId: user?.household_id,
      name,
      icon,
      color,
    });
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.json(category);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req);
    await Category.remove({ id: req.params.id, householdId: user?.household_id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
