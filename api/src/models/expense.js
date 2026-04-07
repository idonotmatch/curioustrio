const db = require('../db');

async function create({ userId, householdId, merchant, description, amount, date, categoryId, source, status = 'pending', notes, placeName = null, address = null, mapkitStableId, linkedExpenseId = null, paymentMethod = 'unknown', cardLast4 = null, cardLabel = null, isPrivate = false }) {
  const result = await db.query(
    `INSERT INTO expenses (user_id, household_id, merchant, description, amount, date, category_id, source, status, notes, place_name, address, mapkit_stable_id, linked_expense_id, payment_method, card_last4, card_label, is_private)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [userId, householdId, merchant, description, amount, date, categoryId, source, status, notes, placeName, address, mapkitStableId, linkedExpenseId, paymentMethod, cardLast4, cardLabel, isPrivate]
  );
  return result.rows[0];
}

function periodBounds(month, startDay = 1) {
  const [year, mon] = month.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const fromDate = new Date(year, mon - 1, startDay);
  const toDate = new Date(year, mon, startDay);
  return {
    from: `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`,
    to: `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`,
  };
}

async function findByUser(userId, { limit = 50, offset = 0, month, startDay = 1, categoryId = null } = {}) {
  const params = [userId, limit, offset];
  let monthClause = '';
  if (month) {
    const { from, to } = periodBounds(month, startDay);
    params.push(from, to);
    monthClause = `AND e.date >= $${params.length - 1} AND e.date < $${params.length}`;
  }
  let categoryClause = '';
  if (categoryId) {
    if (categoryId === 'uncategorized') {
      categoryClause = 'AND e.category_id IS NULL';
    } else {
      params.push(categoryId);
      categoryClause = `AND e.category_id = $${params.length}`;
    }
  }
  const result = await db.query(
    `SELECT e.*,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color,
            pc.name AS category_parent_name,
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
     FROM expenses e
     LEFT JOIN categories  c  ON e.category_id = c.id
     LEFT JOIN categories  pc ON c.parent_id   = pc.id
     WHERE e.user_id = $1 AND e.status = 'confirmed'
     ${monthClause}
     ${categoryClause}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );
  return result.rows;
}

async function updateStatus(id, userId, status) {
  const result = await db.query(
    `UPDATE expenses SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [status, id, userId]
  );
  return result.rows[0] || null;
}

async function findPotentialDuplicates({ householdId, merchant, amount, date, excludeId }) {
  const params = [householdId, merchant, amount, date];
  let excludeClause = '';
  if (excludeId) {
    params.push(excludeId);
    excludeClause = `AND id != $${params.length}`;
  }
  const result = await db.query(
    `SELECT * FROM expenses
     WHERE household_id = $1
       AND LOWER(merchant) = LOWER($2)
       AND ABS(amount - $3) <= 1.00
       AND date BETWEEN ($4::date - INTERVAL '2 days') AND ($4::date + INTERVAL '2 days')
       AND status IN ('pending', 'confirmed')
       ${excludeClause}`,
    params
  );
  return result.rows;
}

async function findByMapkitStableId({ householdId, mapkitStableId, amount, date, excludeId }) {
  const params = [householdId, mapkitStableId, amount, date];
  let excludeClause = '';
  if (excludeId) {
    params.push(excludeId);
    excludeClause = `AND id != $${params.length}`;
  }
  const result = await db.query(
    `SELECT * FROM expenses
     WHERE household_id = $1
       AND mapkit_stable_id = $2
       AND mapkit_stable_id IS NOT NULL
       AND ABS(amount - $3) <= 1.00
       AND date BETWEEN ($4::date - INTERVAL '2 days') AND ($4::date + INTERVAL '2 days')
       AND status IN ('pending', 'confirmed')
       ${excludeClause}`,
    params
  );
  return result.rows;
}

async function findById(id) {
  const result = await db.query(
    `SELECT e.*,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color,
            pc.name AS category_parent_name,
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count,
            u.name AS user_name
     FROM expenses e
     LEFT JOIN categories  c  ON e.category_id = c.id
     LEFT JOIN categories  pc ON c.parent_id   = pc.id
     LEFT JOIN users       u  ON e.user_id     = u.id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByHousehold(householdId, { limit = 50, offset = 0, userId, month, startDay = 1, categoryId = null } = {}) {
  const params = [householdId, limit, offset];
  let privateClause = '';
  if (userId) {
    params.push(userId);
    privateClause = `AND (e.is_private = FALSE OR e.user_id = $${params.length})`;
  }
  let monthClause = '';
  if (month) {
    const { from, to } = periodBounds(month, startDay);
    params.push(from, to);
    monthClause = `AND e.date >= $${params.length - 1} AND e.date < $${params.length}`;
  }
  let categoryClause = '';
  if (categoryId) {
    if (categoryId === 'uncategorized') {
      categoryClause = 'AND e.category_id IS NULL';
    } else {
      params.push(categoryId);
      categoryClause = `AND e.category_id = $${params.length}`;
    }
  }
  const result = await db.query(
    `SELECT e.*,
            c.name  AS category_name,
            c.icon  AS category_icon,
            c.color AS category_color,
            pc.name AS category_parent_name,
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count,
            u.name  AS user_name
     FROM expenses e
     LEFT JOIN categories  c  ON e.category_id = c.id
     LEFT JOIN categories  pc ON c.parent_id   = pc.id
     LEFT JOIN users       u  ON e.user_id     = u.id
     WHERE (e.household_id = $1
            OR e.user_id IN (SELECT id FROM users WHERE household_id = $1))
       AND e.status = 'confirmed'
     ${privateClause}
     ${monthClause}
     ${categoryClause}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );
  return result.rows;
}

async function update(id, userId, {
  merchant, amount, date, categoryId, notes,
  paymentMethod, cardLast4, cardLabel, isPrivate,
  placeName, address, mapkitStableId,
} = {}) {
  const result = await db.query(
    `UPDATE expenses SET
       merchant = COALESCE($3, merchant),
       amount = COALESCE($4, amount),
       date = COALESCE($5, date),
       category_id = COALESCE($6, category_id),
       notes = COALESCE($7, notes),
       payment_method = COALESCE($8, payment_method),
       card_last4 = COALESCE($9, card_last4),
       card_label = COALESCE($10, card_label),
       is_private = COALESCE($11, is_private),
       place_name = COALESCE($12, place_name),
       address = COALESCE($13, address),
       mapkit_stable_id = COALESCE($14, mapkit_stable_id)
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, merchant, amount, date, categoryId, notes, paymentMethod, cardLast4, cardLabel, isPrivate, placeName, address, mapkitStableId]
  );
  return result.rows[0] || null;
}

async function updateStatusByHousehold(id, householdId, status) {
  const result = await db.query(
    `UPDATE expenses SET status = $1 WHERE id = $2 AND household_id = $3 RETURNING *`,
    [status, id, householdId]
  );
  return result.rows[0] || null;
}

module.exports = { create, findByUser, updateStatus, findPotentialDuplicates, findByMapkitStableId, findById, findByHousehold, update, updateStatusByHousehold };
