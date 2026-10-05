const db = require('../db');
const Expense = require('../models/expense');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function transitionPendingExpense(id, userId, nextStatus, { blockPendingDuplicates = false } = {}) {
  const result = await db.query(
    `UPDATE expenses e
     SET status = $3
     WHERE e.id = $1
       AND e.user_id = $2
       AND e.status = 'pending'
       AND ($4::boolean = FALSE OR NOT EXISTS (
         SELECT 1 FROM duplicate_flags f
         WHERE f.status = 'pending'
           AND (f.expense_id_a = e.id OR f.expense_id_b = e.id)
       ))
     RETURNING e.*`,
    [id, userId, nextStatus, blockPendingDuplicates]
  );
  if (result.rows[0]) return { expense: result.rows[0], idempotentReplay: false };

  const current = await Expense.findById(id);
  if (!current || current.user_id !== userId) throw httpError(404, 'Expense not found');
  if (current.status === nextStatus) return { expense: current, idempotentReplay: true };
  if (blockPendingDuplicates && current.status === 'pending') {
    throw httpError(409, 'Resolve the possible duplicate before approving this expense');
  }
  throw httpError(409, 'This expense has already been reviewed');
}

module.exports = { transitionPendingExpense };
