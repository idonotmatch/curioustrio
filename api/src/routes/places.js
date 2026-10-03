const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { searchPlaces, MapkitSearchUnavailableError } = require('../services/mapkitService');
const { captureException } = require('../services/observability');
const User = require('../models/user');
const db = require('../db');

router.use(authenticate);

async function findLearnedPlaces(userId, query) {
  if (!userId || !`${query || ''}`.trim()) return [];
  const result = await db.query(
    `SELECT place_name, address, mapkit_stable_id,
            location_provider_id AS provider_place_id,
            location_latitude AS latitude,
            location_longitude AS longitude,
            COUNT(*)::int AS confirmation_count,
            MAX(created_at) AS last_confirmed_at
     FROM expenses
     WHERE user_id = $1
       AND status = 'confirmed'
       AND location_user_owned = TRUE
       AND (place_name IS NOT NULL OR address IS NOT NULL)
       AND LOWER(REGEXP_REPLACE(COALESCE(merchant, ''), '[^a-zA-Z0-9]+', '', 'g'))
         = LOWER(REGEXP_REPLACE($2, '[^a-zA-Z0-9]+', '', 'g'))
     GROUP BY place_name, address, mapkit_stable_id, location_provider_id,
              location_latitude, location_longitude
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT 3`,
    [userId, query]
  );
  return result.rows.map((row) => ({
    ...row,
    provider: 'user_history',
    source: 'history',
    search_strategy: 'user_history',
    confidence: Number(row.confirmation_count || 0) > 1 ? 1 : 0.92,
  }));
}

function mergePlaceResults(learned = [], searched = []) {
  const seen = new Set();
  return [...learned, ...searched].filter((place) => {
    const key = place.provider_place_id || place.mapkit_stable_id || `${place.place_name || ''}:${place.address || ''}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

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
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced. Call POST /users/sync first.' });
    const learned = await findLearnedPlaces(user.id, q);
    let searched = [];
    if (!(intent === 'auto' && learned.length > 0)) {
      try {
        searched = await searchPlaces(q, parsedLat, parsedLng, radiusMeters, 5, { intent });
      } catch (err) {
        if (!learned.length) throw err;
      }
    }
    const results = mergePlaceResults(learned, searched);
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
