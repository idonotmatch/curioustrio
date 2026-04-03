const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { searchPlace } = require('../services/mapkitService');

router.use(authenticate);

router.get('/search', async (req, res, next) => {
  try {
    const { q, lat, lng, radius } = req.query;
    if (!q || !lat || !lng) {
      return res.status(400).json({ error: 'q, lat, and lng are required' });
    }
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }
    const radiusMeters = radius ? Math.min(Math.max(parseInt(radius), 100), 5000) : 500;
    const result = await searchPlace(q, parsedLat, parsedLng, radiusMeters);
    res.json({ result });
  } catch (err) { next(err); }
});

module.exports = router;
