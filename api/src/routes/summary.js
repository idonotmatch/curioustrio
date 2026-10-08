const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const UserSummarySnapshot = require('../models/userSummarySnapshot');
const { buildSummaryBundle } = require('../services/summaryBundleService');

const router = express.Router();
router.use(authenticate);
const SUMMARY_MAX_AGE_MS = Math.max(30000, Number(process.env.SUMMARY_SNAPSHOT_MAX_AGE_MS || 300000));
const refreshesInFlight = new Map();

function isFreshSnapshot(snapshot) {
  if (snapshot?.payload?.schema_version !== 3) return false;
  const generatedAt = Date.parse(snapshot?.generated_at || '');
  return Number.isFinite(generatedAt) && Date.now() - generatedAt < SUMMARY_MAX_AGE_MS;
}

function refreshSnapshotInBackground(key, { user, period, startDay }) {
  if (refreshesInFlight.has(key)) return;
  const work = buildSummaryBundle({ user, period, startDay })
    .then((payload) => UserSummarySnapshot.upsert({
      userId: user.id,
      householdId: user.household_id,
      period,
      startDay,
      payload,
    }))
    .catch((err) => {
      console.error('[summary] background refresh failed:', err?.message || err);
    })
    .finally(() => refreshesInFlight.delete(key));
  refreshesInFlight.set(key, work);
}

router.get('/', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const period = /^\d{4}-\d{2}$/.test(`${req.query.period || ''}`)
      ? `${req.query.period}`
      : new Date().toISOString().slice(0, 7);
    const requestedStartDay = Number(req.query.start_day || user.budget_start_day || 1);
    if (!Number.isInteger(requestedStartDay) || requestedStartDay < 1 || requestedStartDay > 28) {
      return res.status(400).json({ error: 'start_day must be between 1 and 28' });
    }

    const snapshot = await UserSummarySnapshot.find(user.id, period, requestedStartDay);
    if (snapshot?.payload && isFreshSnapshot(snapshot)) {
      res.setHeader('x-adlo-summary-source', 'projection');
      return res.json(snapshot.payload);
    }

    if (snapshot?.payload?.schema_version === 3) {
      const key = `${user.id}:${period}:${requestedStartDay}`;
      refreshSnapshotInBackground(key, { user, period, startDay: requestedStartDay });
      res.setHeader('x-adlo-summary-source', 'stale-projection');
      return res.json(snapshot.payload);
    }

    const payload = await buildSummaryBundle({ user, period, startDay: requestedStartDay });
    await UserSummarySnapshot.upsert({
      userId: user.id,
      householdId: user.household_id,
      period,
      startDay: requestedStartDay,
      payload,
    });
    res.setHeader('x-adlo-summary-source', 'live');
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
