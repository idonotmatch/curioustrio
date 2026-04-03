const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const Household = require('../models/household');
const BudgetSetting = require('../models/budgetSetting');
const db = require('../db');

router.use(authenticate);

async function requireUser(req, res) {
  const user = await User.findByProviderUid(req.userId);
  if (!user) { res.status(401).json({ error: 'User not synced' }); return null; }
  return user;
}

function parseStartDay(value, fallback) {
  if (value === undefined) return fallback;
  const day = parseInt(value, 10);
  if (!Number.isInteger(day) || day < 1 || day > 28) return null;
  return day;
}

// Given a YYYY-MM period key and a budget start day, return the [from, to) date strings.
// e.g. periodBounds('2026-04', 15) => { from: '2026-04-15', to: '2026-05-15' }
// e.g. periodBounds('2026-04', 1)  => { from: '2026-04-01', to: '2026-05-01' }
function periodBounds(month, startDay = 1) {
  const [year, mon] = month.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const fromDate = new Date(year, mon - 1, startDay);
  const toDate = new Date(year, mon, startDay); // same day next month
  return {
    from: `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`,
    to: `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`,
  };
}

// GET /budgets — summary: budget limits + current period spending
router.get('/', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const month = req.query.month || new Date().toISOString().slice(0, 7);
    // ?scope=personal forces the solo path even for household members
    const useHouseholdPath = user.household_id && req.query.scope !== 'personal';

    if (useHouseholdPath) {
      const household = await Household.findById(user.household_id);
      const startDay = parseStartDay(req.query.start_day, household?.budget_start_day || 1);
      if (startDay === null) return res.status(400).json({ error: 'start_day must be between 1 and 28' });
      const { from, to } = periodBounds(month, startDay);
      // Household path: aggregate across all members
      const settings = await BudgetSetting.findByHousehold(user.household_id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE (household_id = $1 OR user_id IN (SELECT id FROM users WHERE household_id = $1))
           AND status = 'confirmed' AND date >= $2 AND date < $3
         GROUP BY category_id`,
        [user.household_id, from, to]
      );
      const spendByCategory = {};
      for (const row of spendResult.rows) {
        spendByCategory[row.category_id || '__total__'] = Number(row.spent);
      }
      const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

      const parentSpendResult = await db.query(
        `SELECT COALESCE(c.parent_id, e.category_id) AS group_id, SUM(e.amount) AS spent
         FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
         WHERE (e.household_id = $1 OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
           AND e.status = 'confirmed' AND e.date >= $2 AND e.date < $3
         GROUP BY group_id`,
        [user.household_id, from, to]
      );
      const groupIds = parentSpendResult.rows.map(r => r.group_id).filter(Boolean);
      const catNames = {};
      if (groupIds.length > 0) {
        const catRes = await db.query('SELECT id, name FROM categories WHERE id = ANY($1)', [groupIds]);
        for (const row of catRes.rows) catNames[row.id] = row.name;
      }
      const by_parent = parentSpendResult.rows
        .filter(r => r.group_id)
        .map(r => {
          const spent = Number(r.spent);
          const setting = settings.find(s => s.category_id === r.group_id);
          const limit = setting ? Number(setting.monthly_limit) : null;
          return { group_id: r.group_id, name: catNames[r.group_id] || 'Unknown', spent, limit, remaining: limit !== null ? limit - spent : null };
        });

      const totalSetting = settings.find(s => s.category_id === null);
      const categorySummaries = settings
        .filter(s => s.category_id !== null)
        .map(s => {
          const spent = spendByCategory[s.category_id] || 0;
          return { id: s.category_id, limit: Number(s.monthly_limit), spent, remaining: Number(s.monthly_limit) - spent };
        });

      return res.json({
        total: totalSetting
          ? { limit: Number(totalSetting.monthly_limit), spent: totalSpent, remaining: Number(totalSetting.monthly_limit) - totalSpent }
          : null,
        categories: categorySummaries,
        by_parent,
        period: { from, to },
      });
    } else {
      const startDay = parseStartDay(req.query.start_day, user.budget_start_day || 1);
      if (startDay === null) return res.status(400).json({ error: 'start_day must be between 1 and 28' });
      const { from, to } = periodBounds(month, startDay);
      // Solo user path
      const settings = await BudgetSetting.findByUser(user.id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE user_id = $1 AND status = 'confirmed' AND date >= $2 AND date < $3
         GROUP BY category_id`,
        [user.id, from, to]
      );
      const spendByCategory = {};
      for (const row of spendResult.rows) {
        spendByCategory[row.category_id || '__total__'] = Number(row.spent);
      }
      const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

      const parentSpendResult = await db.query(
        `SELECT COALESCE(c.parent_id, e.category_id) AS group_id, SUM(e.amount) AS spent
         FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
         WHERE e.user_id = $1 AND e.status = 'confirmed' AND e.date >= $2 AND e.date < $3
         GROUP BY group_id`,
        [user.id, from, to]
      );
      const groupIds = parentSpendResult.rows.map(r => r.group_id).filter(Boolean);
      const catNames = {};
      if (groupIds.length > 0) {
        const catRes = await db.query('SELECT id, name FROM categories WHERE id = ANY($1)', [groupIds]);
        for (const row of catRes.rows) catNames[row.id] = row.name;
      }
      const by_parent = parentSpendResult.rows
        .filter(r => r.group_id)
        .map(r => {
          const spent = Number(r.spent);
          const setting = settings.find(s => s.category_id === r.group_id);
          const limit = setting ? Number(setting.monthly_limit) : null;
          return { group_id: r.group_id, name: catNames[r.group_id] || 'Unknown', spent, limit, remaining: limit !== null ? limit - spent : null };
        });

      const totalSetting = settings.find(s => s.category_id === null);
      const categorySummaries = settings
        .filter(s => s.category_id !== null)
        .map(s => {
          const spent = spendByCategory[s.category_id] || 0;
          return { id: s.category_id, limit: Number(s.monthly_limit), spent, remaining: Number(s.monthly_limit) - spent };
        });

      return res.json({
        total: totalSetting
          ? { limit: Number(totalSetting.monthly_limit), spent: totalSpent, remaining: Number(totalSetting.monthly_limit) - totalSpent }
          : null,
        categories: categorySummaries,
        by_parent,
        period: { from, to },
      });
    }
  } catch (err) { next(err); }
});

// PUT /budgets/total
router.put('/total', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { monthly_limit } = req.body;
    if (!monthly_limit || isNaN(Number(monthly_limit)) || Number(monthly_limit) <= 0) {
      return res.status(400).json({ error: 'monthly_limit must be a positive number' });
    }
    const setting = await BudgetSetting.upsert({ userId: user.id, categoryId: null, monthlyLimit: monthly_limit });
    res.json(setting);
  } catch (err) { next(err); }
});

// PUT /budgets/category/:id
router.put('/category/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const { monthly_limit } = req.body;
    if (!monthly_limit || isNaN(Number(monthly_limit)) || Number(monthly_limit) <= 0) {
      return res.status(400).json({ error: 'monthly_limit must be a positive number' });
    }
    const setting = await BudgetSetting.upsert({ userId: user.id, categoryId: req.params.id, monthlyLimit: monthly_limit });
    res.json(setting);
  } catch (err) { next(err); }
});

// DELETE /budgets/category/:id
router.delete('/category/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const removed = await BudgetSetting.remove({ userId: user.id, categoryId: req.params.id });
    if (!removed) return res.status(404).json({ error: 'Budget not found' });
    res.json(removed);
  } catch (err) { next(err); }
});

module.exports = router;
