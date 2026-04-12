const db = require('../db');

function isMissingExpenseReviewMetadataError(err) {
  return err?.code === '42703' && /review_(required|mode|source)/i.test(`${err?.message || ''}`);
}

function isMissingExcludeFromBudgetError(err) {
  return err?.code === '42703' && /exclude_from_budget/i.test(`${err?.message || ''}`);
}

function isMissingBudgetExclusionReasonError(err) {
  return err?.code === '42703' && /budget_exclusion_reason/i.test(`${err?.message || ''}`);
}

async function create({
  userId,
  householdId,
  merchant,
  description,
  amount,
  date,
  categoryId,
  source,
  status = 'pending',
  notes,
  placeName = null,
  address = null,
  mapkitStableId,
  linkedExpenseId = null,
  paymentMethod = 'unknown',
  cardLast4 = null,
  cardLabel = null,
  isPrivate = false,
  excludeFromBudget = false,
  budgetExclusionReason = null,
  reviewRequired = false,
  reviewMode = null,
  reviewSource = null,
}) {
  try {
    const result = await db.query(
      `INSERT INTO expenses (
         user_id, household_id, merchant, description, amount, date, category_id, source, status, notes,
         place_name, address, mapkit_stable_id, linked_expense_id, payment_method, card_last4, card_label,
         is_private, exclude_from_budget, budget_exclusion_reason, review_required, review_mode, review_source
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [
        userId, householdId, merchant, description, amount, date, categoryId, source, status, notes,
        placeName, address, mapkitStableId, linkedExpenseId, paymentMethod, cardLast4, cardLabel,
        isPrivate, excludeFromBudget, budgetExclusionReason, reviewRequired, reviewMode, reviewSource,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (!isMissingExpenseReviewMetadataError(err) && !isMissingExcludeFromBudgetError(err) && !isMissingBudgetExclusionReasonError(err)) throw err;
    const fallback = await db.query(
      `INSERT INTO expenses (
         user_id, household_id, merchant, description, amount, date, category_id, source, status, notes,
         place_name, address, mapkit_stable_id, linked_expense_id, payment_method, card_last4, card_label,
         is_private
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        userId, householdId, merchant, description, amount, date, categoryId, source, status, notes,
        placeName, address, mapkitStableId, linkedExpenseId, paymentMethod, cardLast4, cardLabel,
        isPrivate,
      ]
    );
    return fallback.rows[0];
  }
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

async function updateReviewMetadata(id, userId, {
  reviewRequired,
  reviewMode,
  reviewSource,
} = {}) {
  const hasReviewRequired = reviewRequired !== undefined;
  const hasReviewMode = reviewMode !== undefined;
  const hasReviewSource = reviewSource !== undefined;
  try {
    const result = await db.query(
      `UPDATE expenses SET
         review_required = CASE WHEN $3 THEN $4 ELSE review_required END,
         review_mode = CASE WHEN $5 THEN $6 ELSE review_mode END,
         review_source = CASE WHEN $7 THEN $8 ELSE review_source END
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        id,
        userId,
        hasReviewRequired, reviewRequired,
        hasReviewMode, reviewMode,
        hasReviewSource, reviewSource,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingExpenseReviewMetadataError(err)) throw err;
    const fallback = await db.query(
      `SELECT * FROM expenses WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return fallback.rows[0] || null;
  }
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

async function findTreatmentCandidates({ userId, merchant, categoryId = null, excludeId = null, limit = 24 }) {
  const params = [userId];
  const filters = [`user_id = $1`, `status = 'confirmed'`];

  const merchantValue = `${merchant || ''}`.trim();
  const hasMerchant = merchantValue.length > 0;
  const hasCategoryId = !!categoryId;

  if (hasMerchant && hasCategoryId) {
    params.push(merchantValue, categoryId);
    filters.push(`(LOWER(COALESCE(merchant, '')) = LOWER($2) OR category_id = $3)`);
  } else if (hasMerchant) {
    params.push(merchantValue);
    filters.push(`LOWER(COALESCE(merchant, '')) = LOWER($2)`);
  } else if (hasCategoryId) {
    params.push(categoryId);
    filters.push(`category_id = $2`);
  } else {
    return [];
  }

  if (excludeId) {
    params.push(excludeId);
    filters.push(`id != $${params.length}`);
  }

  params.push(Math.max(1, Math.min(Number(limit) || 24, 50)));

  const result = await db.query(
    `SELECT id, merchant, description, amount, date, category_id, is_private, exclude_from_budget, budget_exclusion_reason, source
     FROM expenses
     WHERE ${filters.join(' AND ')}
     ORDER BY date DESC, created_at DESC
     LIMIT $${params.length}`,
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
  paymentMethod, cardLast4, cardLabel, isPrivate, excludeFromBudget, budgetExclusionReason,
  placeName, address, mapkitStableId,
} = {}) {
  const hasMerchant = merchant !== undefined;
  const hasAmount = amount !== undefined;
  const hasDate = date !== undefined;
  const hasCategoryId = categoryId !== undefined;
  const hasNotes = notes !== undefined;
  const hasPaymentMethod = paymentMethod !== undefined;
  const hasCardLast4 = cardLast4 !== undefined;
  const hasCardLabel = cardLabel !== undefined;
  const hasIsPrivate = isPrivate !== undefined;
  const hasExcludeFromBudget = excludeFromBudget !== undefined;
  const hasBudgetExclusionReason = budgetExclusionReason !== undefined;
  const hasPlaceName = placeName !== undefined;
  const hasAddress = address !== undefined;
  const hasMapkitStableId = mapkitStableId !== undefined;
  try {
    const result = await db.query(
      `UPDATE expenses SET
         merchant = CASE WHEN $3 THEN $4 ELSE merchant END,
         amount = CASE WHEN $5 THEN $6 ELSE amount END,
         date = CASE WHEN $7 THEN $8 ELSE date END,
         category_id = CASE WHEN $9 THEN $10 ELSE category_id END,
         notes = CASE WHEN $11 THEN $12 ELSE notes END,
         payment_method = CASE WHEN $13 THEN $14 ELSE payment_method END,
         card_last4 = CASE WHEN $15 THEN $16 ELSE card_last4 END,
         card_label = CASE WHEN $17 THEN $18 ELSE card_label END,
         is_private = CASE WHEN $19 THEN $20 ELSE is_private END,
         exclude_from_budget = CASE WHEN $21 THEN $22 ELSE exclude_from_budget END,
         budget_exclusion_reason = CASE WHEN $23 THEN $24 ELSE budget_exclusion_reason END,
         place_name = CASE WHEN $25 THEN $26 ELSE place_name END,
         address = CASE WHEN $27 THEN $28 ELSE address END,
         mapkit_stable_id = CASE WHEN $29 THEN $30 ELSE mapkit_stable_id END
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id, userId,
        hasMerchant, merchant,
        hasAmount, amount,
        hasDate, date,
        hasCategoryId, categoryId,
        hasNotes, notes,
        hasPaymentMethod, paymentMethod,
        hasCardLast4, cardLast4,
        hasCardLabel, cardLabel,
        hasIsPrivate, isPrivate,
        hasExcludeFromBudget, excludeFromBudget,
        hasBudgetExclusionReason, budgetExclusionReason,
        hasPlaceName, placeName,
        hasAddress, address,
        hasMapkitStableId, mapkitStableId,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingExcludeFromBudgetError(err) && !isMissingBudgetExclusionReasonError(err)) throw err;
    const fallback = await db.query(
      `UPDATE expenses SET
         merchant = CASE WHEN $3 THEN $4 ELSE merchant END,
         amount = CASE WHEN $5 THEN $6 ELSE amount END,
         date = CASE WHEN $7 THEN $8 ELSE date END,
         category_id = CASE WHEN $9 THEN $10 ELSE category_id END,
         notes = CASE WHEN $11 THEN $12 ELSE notes END,
         payment_method = CASE WHEN $13 THEN $14 ELSE payment_method END,
         card_last4 = CASE WHEN $15 THEN $16 ELSE card_last4 END,
         card_label = CASE WHEN $17 THEN $18 ELSE card_label END,
         is_private = CASE WHEN $19 THEN $20 ELSE is_private END,
         place_name = CASE WHEN $21 THEN $22 ELSE place_name END,
         address = CASE WHEN $23 THEN $24 ELSE address END,
         mapkit_stable_id = CASE WHEN $25 THEN $26 ELSE mapkit_stable_id END
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id, userId,
        hasMerchant, merchant,
        hasAmount, amount,
        hasDate, date,
        hasCategoryId, categoryId,
        hasNotes, notes,
        hasPaymentMethod, paymentMethod,
        hasCardLast4, cardLast4,
        hasCardLabel, cardLabel,
        hasIsPrivate, isPrivate,
        hasPlaceName, placeName,
        hasAddress, address,
        hasMapkitStableId, mapkitStableId,
      ]
    );
    return fallback.rows[0] || null;
  }
}

async function updateStatusByHousehold(id, householdId, status) {
  const result = await db.query(
    `UPDATE expenses SET status = $1 WHERE id = $2 AND household_id = $3 RETURNING *`,
    [status, id, householdId]
  );
  return result.rows[0] || null;
}

module.exports = { create, findByUser, updateStatus, updateReviewMetadata, findPotentialDuplicates, findTreatmentCandidates, findByMapkitStableId, findById, findByHousehold, update, updateStatusByHousehold };
