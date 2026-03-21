const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByAuth0Id(req.auth0Id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/sync', authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email required' });
    }
    const user = await User.findOrCreate({ auth0Id: req.auth0Id, name, email });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
