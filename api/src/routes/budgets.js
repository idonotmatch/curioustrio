const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/user');
const BudgetSetting = require('../models/budgetSetting');
const db = require('../db');

router.use(authenticate);

async function requireUser(req, res) {
  const user = await User.findByProviderUid(req.userId);
  if (!user) { res.status(401).json({ error: 'User not synced' }); return null; }
  return user;
}

// GET /budgets — summary: budget limits + current month spending
router.get('/', async (req, res, next) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const month = req.query.month || new Date().toISOString().slice(0, 7);
    // ?scope=personal forces the solo path even for household members
    const useHouseholdPath = user.household_id && req.query.scope !== 'personal';

    if (useHouseholdPath) {
      // Household path: aggregate across all members
      const settings = await BudgetSetting.findByHousehold(user.household_id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE (household_id = $1 OR user_id IN (SELECT id FROM users WHERE household_id = $1))
           AND status = 'confirmed' AND to_char(date, 'YYYY-MM') = $2
         GROUP BY category_id`,
        [user.household_id, month]
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
           AND e.status = 'confirmed' AND to_char(e.date, 'YYYY-MM') = $2
         GROUP BY group_id`,
        [user.household_id, month]
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
      });
    } else {
      // Solo user path
      const settings = await BudgetSetting.findByUser(user.id);

      const spendResult = await db.query(
        `SELECT category_id, SUM(amount) as spent FROM expenses
         WHERE user_id = $1 AND status = 'confirmed' AND to_char(date, 'YYYY-MM') = $2
         GROUP BY category_id`,
        [user.id, month]
      );
      const spendByCategory = {};
      for (const row of spendResult.rows) {
        spendByCategory[row.category_id || '__total__'] = Number(row.spent);
      }
      const totalSpent = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

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
        by_parent: [],
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
