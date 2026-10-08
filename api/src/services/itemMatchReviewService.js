const db = require('../db');
const Expense = require('../models/expense');
const ExpenseItem = require('../models/expenseItem');
const ItemMatchDecision = require('../models/itemMatchDecision');
const { normalizeItemMetadata } = require('./itemNormalizer');

const VALID_DECISIONS = new Set(['same', 'different']);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function recordItemMatchDecision({ user, expenseId, itemId, decision }) {
  if (!VALID_DECISIONS.has(decision)) {
    throw httpError(400, 'decision must be same or different');
  }
  if (!user?.household_id) {
    throw httpError(400, 'A household is required to remember item matches');
  }

  const expense = await Expense.findById(expenseId);
  if (!expense || expense.user_id !== user.id) throw httpError(404, 'Expense not found');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const item = await ExpenseItem.findByIdForExpense(itemId, expenseId, client);
    if (!item) throw httpError(404, 'Expense item not found');
    if (!item.product_id || item.product_match_confidence !== 'medium') {
      throw httpError(409, 'This item match no longer needs review');
    }

    const normalized = normalizeItemMetadata(item);
    if (!normalized.normalized_name) throw httpError(400, 'Item name cannot be matched');

    await ItemMatchDecision.upsert({
      householdId: user.household_id,
      userId: user.id,
      expenseItemId: item.id,
      observationKey: item.observation_key,
      normalizedName: normalized.normalized_name,
      merchant: expense.merchant,
      candidateProductId: item.product_id,
      decision,
    }, client);

    const updated = await ExpenseItem.updateResolution(item.id, expenseId, decision === 'same'
      ? {
          productId: item.product_id,
          productMatchConfidence: 'high',
          productMatchReason: 'user_confirmed_match',
        }
      : {
          productId: null,
          productMatchConfidence: null,
          productMatchReason: 'user_rejected_match',
        }, client);
    if (decision === 'same') {
      await ExpenseItem.applyConfirmedAlias({
        householdId: user.household_id,
        normalizedName: normalized.normalized_name,
        merchant: expense.merchant,
        productId: item.product_id,
        excludeItemId: item.id,
      }, client);
    }
    await client.query('COMMIT');
    return { expense, item: updated };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordItemMatchDecision };
