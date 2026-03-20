const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');

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
