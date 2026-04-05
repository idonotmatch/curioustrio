const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { searchPlaces, MapkitSearchUnavailableError } = require('../services/mapkitService');

router.use(authenticate);

router.get('/search', async (req, res, next) => {
  try {
    const { q, lat, lng, radius } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }
    let parsedLat = null;
    let parsedLng = null;
    if (lat !== undefined || lng !== undefined) {
      parsedLat = parseFloat(lat);
      parsedLng = parseFloat(lng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return res.status(400).json({ error: 'lat and lng must be numbers' });
      }
    }
    const radiusMeters = radius ? Math.min(Math.max(parseInt(radius), 100), 5000) : 500;
    const results = await searchPlaces(q, parsedLat, parsedLng, radiusMeters);
    res.json({ result: results[0] || null, results });
  } catch (err) {
    if (err instanceof MapkitSearchUnavailableError || err?.name === 'MapkitSearchUnavailableError') {
      return res.status(503).json({ error: 'Place search temporarily unavailable' });
    }
    next(err);
  }
});

module.exports = router;
