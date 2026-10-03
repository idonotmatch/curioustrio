const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { searchPlaces, MapkitSearchUnavailableError } = require('../services/mapkitService');
const { captureException } = require('../services/observability');

router.use(authenticate);

function redactPlaceSearchContext(query) {
  const normalized = `${query || ''}`.trim();
  return {
    query_present: !!normalized,
    query_length: normalized.length || 0,
  };
}

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
      if (
        isNaN(parsedLat)
        || isNaN(parsedLng)
        || parsedLat < -90
        || parsedLat > 90
        || parsedLng < -180
        || parsedLng > 180
      ) {
        return res.status(400).json({ error: 'lat and lng must be numbers' });
      }
    }
    const radiusMeters = radius ? Math.min(Math.max(parseInt(radius), 100), 5000) : 500;
    const intent = req.query.intent === 'auto' ? 'auto' : 'manual';
    const results = await searchPlaces(q, parsedLat, parsedLng, radiusMeters, 5, { intent });
    res.json({ result: results[0] || null, results });
    } catch (err) {
      if (err instanceof MapkitSearchUnavailableError || err?.name === 'MapkitSearchUnavailableError') {
        captureException(err, {
          area: 'places_search',
          ...redactPlaceSearchContext(req.query?.q),
          has_location_bias: req.query?.lat != null && req.query?.lng != null,
        });
        console.error('[places/search] unavailable', {
          ...redactPlaceSearchContext(req.query?.q),
          has_location_bias: req.query?.lat != null && req.query?.lng != null,
          reason: err.message,
          details_present: !!err.details,
        });
        return res.status(503).json({ error: 'Place search temporarily unavailable' });
      }
    next(err);
  }
});

module.exports = router;
