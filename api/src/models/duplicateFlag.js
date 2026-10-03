const db = require('../db');

function isMissingDuplicateFlagsTableError(err) {
  return err?.code === '42P01' && `${err?.message || ''}`.includes('duplicate_flags');
}

function canonicalPair(expenseIdA, expenseIdB) {
  return [expenseIdA, expenseIdB].sort();
}

function mapDuplicateFlag(row) {
  if (!row) return null;
  const {
    duplicate_id,
    duplicate_merchant,
    duplicate_description,
    duplicate_amount,
    duplicate_date,
    duplicate_source,
    duplicate_status,
    duplicate_category_name,
    duplicate_payment_method,
    duplicate_card_last4,
    duplicate_card_label,
    duplicate_place_name,
    duplicate_address,
    duplicate_item_count,
    duplicate_owned_by_viewer,
    ...flag
  } = row;
  if (!duplicate_id) return flag;
  return {
    ...flag,
    can_replace_duplicate: duplicate_owned_by_viewer === true,
    duplicate_expense: {
      id: duplicate_id,
      merchant: duplicate_merchant,
      description: duplicate_description,
      amount: duplicate_amount,
      date: duplicate_date,
      source: duplicate_source,
      status: duplicate_status,
      category_name: duplicate_category_name,
      payment_method: duplicate_payment_method,
      card_last4: duplicate_card_last4,
      card_label: duplicate_card_label,
      place_name: duplicate_place_name,
      address: duplicate_address,
      item_count: duplicate_item_count,
    },
  };
}

async function create({ expenseIdA, expenseIdB, confidence, score = null, matchReasons = [] }) {
  const [canonicalA, canonicalB] = canonicalPair(expenseIdA, expenseIdB);
  const result = await db.query(
    `INSERT INTO duplicate_flags (expense_id_a, expense_id_b, confidence, score, match_reasons)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [canonicalA, canonicalB, confidence, score, JSON.stringify(matchReasons)]
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await db.query(
    `SELECT * FROM duplicate_flags
     WHERE LEAST(expense_id_a, expense_id_b) = $1
       AND GREATEST(expense_id_a, expense_id_b) = $2
     LIMIT 1`,
    [canonicalA, canonicalB]
  );
  return existing.rows[0] || null;
}

async function findByExpenseId(expenseId, { userId = null, pendingOnly = true } = {}) {
  try {
    const result = await db.query(
      `SELECT df.*,
              other.id AS duplicate_id,
              other.merchant AS duplicate_merchant,
              other.description AS duplicate_description,
              other.amount AS duplicate_amount,
              other.date AS duplicate_date,
              other.source AS duplicate_source,
              other.status AS duplicate_status,
              category.name AS duplicate_category_name,
              other.payment_method AS duplicate_payment_method,
              other.card_last4 AS duplicate_card_last4,
              other.card_label AS duplicate_card_label,
              other.place_name AS duplicate_place_name,
              other.address AS duplicate_address,
              (SELECT COUNT(*) FROM expense_items WHERE expense_id = other.id)::int AS duplicate_item_count,
              (other.user_id = $2) AS duplicate_owned_by_viewer
       FROM duplicate_flags df
       JOIN expenses other
         ON other.id = CASE WHEN df.expense_id_a = $1 THEN df.expense_id_b ELSE df.expense_id_a END
       LEFT JOIN categories category ON category.id = other.category_id
       WHERE (df.expense_id_a = $1 OR df.expense_id_b = $1)
         AND ($3::boolean = FALSE OR df.status = 'pending')
         AND ($2::uuid IS NULL OR other.is_private = FALSE OR other.user_id = $2)
       ORDER BY df.created_at DESC`,
      [expenseId, userId, pendingOnly]
    );
    return result.rows.map(mapDuplicateFlag);
  } catch (err) {
    if (!isMissingDuplicateFlagsTableError(err)) throw err;
    return [];
  }
}

async function updateStatus(id, { status, resolvedBy }) {
  const result = await db.query(
    `UPDATE duplicate_flags
     SET status = $2, resolved_by = $3, resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, resolvedBy || null]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query('SELECT * FROM duplicate_flags WHERE id = $1', [id]);
  return result.rows[0] || null;
}

module.exports = { create, findByExpenseId, findById, updateStatus };
