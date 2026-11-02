const express = require('express');
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const UserSummarySnapshot = require('../models/userSummarySnapshot');
const { buildSummaryBundle } = require('../services/summaryBundleService');
const db = require('../db');
const { buildWidgetSnapshot, currentBudgetPeriod } = require('../services/widgetSnapshotService');
const { householdExpenseVisibilitySql } = require('../services/expenseAccessPolicy');

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

router.get('/widget', async (req, res, next) => {
  try {
    const user = await User.findByProviderUid(req.userId);
    if (!user) return res.status(401).json({ error: 'User not synced' });

    const today = /^\d{4}-\d{2}-\d{2}$/.test(`${req.query.today || ''}`)
      ? `${req.query.today}`
      : new Date().toISOString().slice(0, 10);
    const householdResult = user.household_id
      ? await db.query(
          `SELECT h.budget_start_day, COUNT(u.id)::int AS member_count
           FROM households h
           LEFT JOIN users u ON u.household_id = h.id
           WHERE h.id = $1
           GROUP BY h.id`,
          [user.household_id]
        )
      : { rows: [] };
    const household = householdResult.rows[0] || null;
    const hasFamilyBudget = Number(household?.member_count || 0) > 1;
    const startDay = Math.max(1, Math.min(
      28,
      Number(hasFamilyBudget ? household?.budget_start_day : user.budget_start_day) || 1
    ));
    const period = currentBudgetPeriod(today, startDay);
    const from = period.from.toISOString().slice(0, 10);
    const to = period.to.toISOString().slice(0, 10);
    const result = await db.query(
      `SELECT
         (SELECT monthly_limit
          FROM budget_settings
          WHERE user_id = $1 AND category_id IS NULL
          LIMIT 1) AS budget_limit,
         (SELECT COALESCE(SUM(amount), 0)
          FROM expenses
          WHERE user_id = $1
            AND status = 'confirmed'
            AND exclude_from_budget = FALSE
            AND date >= $2 AND date < $3) AS spent,
         (SELECT COUNT(*)::int
          FROM expenses
          WHERE user_id = $1 AND status = 'pending') AS pending_count,
         (SELECT SUM(bs.monthly_limit)
          FROM budget_settings bs
          JOIN users budget_user ON budget_user.id = bs.user_id
          WHERE budget_user.household_id = $4
            AND bs.category_id IS NULL) AS family_budget_limit,
         (SELECT COALESCE(SUM(e.amount), 0)
          FROM expenses e
          WHERE $4::uuid IS NOT NULL
            AND (e.household_id = $4 OR e.user_id IN (
              SELECT id FROM users WHERE household_id = $4
            ))
            AND ${householdExpenseVisibilitySql(5)}
            AND e.status = 'confirmed'
            AND e.exclude_from_budget = FALSE
            AND e.date >= $2 AND e.date < $3) AS family_spent`,
      [user.id, from, to, user.household_id, user.id]
    );
    const row = result.rows[0] || {};
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.json(buildWidgetSnapshot({
      budgetLimit: row.budget_limit,
      spent: row.spent,
      familyBudgetLimit: row.family_budget_limit,
      familySpent: row.family_spent,
      hasFamilyBudget,
      pendingCount: row.pending_count,
      startDay,
      today,
    }));
  } catch (err) {
    next(err);
  }
});

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
