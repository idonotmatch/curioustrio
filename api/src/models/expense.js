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

function isMissingCategoryProvenanceError(err) {
  return err?.code === '42703' && /category_(source|confidence|reasoning)/i.test(`${err?.message || ''}`);
}

function isMissingLocationProvenanceError(err) {
  return err?.code === '42703'
    && /location_(provider_id|latitude|longitude|source|status|confidence|user_owned)/i.test(`${err?.message || ''}`);
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
  locationProviderId = null,
  locationLatitude = null,
  locationLongitude = null,
  locationSource = null,
  locationStatus = null,
  locationConfidence = null,
  locationUserOwned = false,
  linkedExpenseId = null,
  paymentMethod = 'unknown',
  cardLast4 = null,
  cardLabel = null,
  isPrivate = false,
  excludeFromBudget = false,
  budgetExclusionReason = null,
  categorySource = null,
  categoryConfidence = null,
  categoryReasoning = null,
  reviewRequired = false,
  reviewMode = null,
  reviewSource = null,
  idempotencyKey = null,
}) {
  try {
    const result = await db.query(
      `INSERT INTO expenses (
         user_id, household_id, merchant, description, amount, date, category_id, source, status, notes,
         place_name, address, mapkit_stable_id,
         location_provider_id, location_latitude, location_longitude, location_source,
         location_status, location_confidence, location_user_owned,
         linked_expense_id, payment_method, card_last4, card_label,
         is_private, exclude_from_budget, budget_exclusion_reason,
         category_source, category_confidence, category_reasoning,
         review_required, review_mode, review_source, idempotency_key
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        userId, householdId, merchant, description, amount, date, categoryId, source, status, notes,
        placeName, address, mapkitStableId,
        locationProviderId, locationLatitude, locationLongitude, locationSource,
        locationStatus, locationConfidence, locationUserOwned,
        linkedExpenseId, paymentMethod, cardLast4, cardLabel,
        isPrivate, excludeFromBudget, budgetExclusionReason,
        categorySource, categoryConfidence, categoryReasoning ? JSON.stringify(categoryReasoning) : null,
        reviewRequired, reviewMode, reviewSource, idempotencyKey,
      ]
    );
    if (result.rows[0]) return result.rows[0];
    if (idempotencyKey) {
      const existing = await db.query(
        `SELECT * FROM expenses WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [userId, idempotencyKey]
      );
      if (existing.rows[0]) return { ...existing.rows[0], _idempotent_replay: true };
    }
    throw new Error('Expense insert did not return a row');
  } catch (err) {
    if (
      !isMissingExpenseReviewMetadataError(err)
      && !isMissingExcludeFromBudgetError(err)
      && !isMissingBudgetExclusionReasonError(err)
      && !isMissingCategoryProvenanceError(err)
      && !isMissingLocationProvenanceError(err)
    ) throw err;
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

async function findByUser(userId, { limit = 50, offset = 0, month, startDay = 1, categoryId = null, cursor = null } = {}) {
  const params = [userId, limit, offset];
  let cursorClause = '';
  if (cursor) {
    params.push(cursor.date, cursor.created_at, cursor.id);
    cursorClause = `AND (e.date, e.created_at, e.id) < ($${params.length - 2}::date, $${params.length - 1}::timestamptz, $${params.length}::uuid)`;
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
            (SELECT COUNT(*) FROM expense_items WHERE expense_id = e.id)::int AS item_count
     FROM expenses e
     LEFT JOIN categories  c  ON e.category_id = c.id
     LEFT JOIN categories  pc ON c.parent_id   = pc.id
     WHERE e.user_id = $1 AND e.status = 'confirmed'
     ${cursorClause}
     ${monthClause}
     ${categoryClause}
     ORDER BY e.date DESC, e.created_at DESC, e.id DESC
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

async function findPotentialDuplicates({ householdId, userId, merchant, amount, date, excludeId }) {
  if (!householdId && !userId) return [];
  const scopeColumn = householdId ? 'household_id' : 'user_id';
  const scopeId = householdId || userId;
  const params = [scopeId, merchant, amount, date];
  let privacyClause = '';
  if (householdId && userId) {
    params.push(userId);
    privacyClause = `AND (is_private = FALSE OR user_id = $${params.length})`;
  }
  let excludeClause = '';
  if (excludeId) {
    params.push(excludeId);
    excludeClause = `AND id != $${params.length}`;
  }
  const result = await db.query(
    `SELECT * FROM expenses
     WHERE ${scopeColumn} = $1
       AND REGEXP_REPLACE(LOWER(COALESCE(merchant, '')), '[^a-z0-9]+', '', 'g') =
           REGEXP_REPLACE(LOWER(COALESCE($2, '')), '[^a-z0-9]+', '', 'g')
       AND ABS(amount - $3) <= 1.00
       AND date BETWEEN ($4::date - INTERVAL '2 days') AND ($4::date + INTERVAL '2 days')
       AND status IN ('pending', 'confirmed')
       ${privacyClause}
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
    `SELECT e.id, e.merchant, e.description, e.amount, e.date, e.category_id,
            c.name AS category_name,
            e.payment_method, e.card_label, e.card_last4,
            e.is_private, e.exclude_from_budget, e.budget_exclusion_reason, e.source
     FROM expenses e
     LEFT JOIN categories c ON e.category_id = c.id
     WHERE ${filters.join(' AND ')}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function findByMapkitStableId({ householdId, userId, mapkitStableId, amount, date, excludeId }) {
  if (!householdId && !userId) return [];
  const scopeColumn = householdId ? 'household_id' : 'user_id';
  const scopeId = householdId || userId;
  const params = [scopeId, mapkitStableId, amount, date];
  let privacyClause = '';
  if (householdId && userId) {
    params.push(userId);
    privacyClause = `AND (is_private = FALSE OR user_id = $${params.length})`;
  }
  let excludeClause = '';
  if (excludeId) {
    params.push(excludeId);
    excludeClause = `AND id != $${params.length}`;
  }
  const result = await db.query(
    `SELECT * FROM expenses
     WHERE ${scopeColumn} = $1
       AND mapkit_stable_id = $2
       AND mapkit_stable_id IS NOT NULL
       AND ABS(amount - $3) <= 1.00
       AND date BETWEEN ($4::date - INTERVAL '2 days') AND ($4::date + INTERVAL '2 days')
       AND status IN ('pending', 'confirmed')
       ${privacyClause}
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

async function findByHousehold(householdId, { limit = 50, offset = 0, userId, month, startDay = 1, categoryId = null, cursor = null } = {}) {
  const params = [householdId, limit, offset];
  let cursorClause = '';
  if (cursor) {
    params.push(cursor.date, cursor.created_at, cursor.id);
    cursorClause = `AND (e.date, e.created_at, e.id) < ($${params.length - 2}::date, $${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
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
     ${cursorClause}
     ${privateClause}
     ${monthClause}
     ${categoryClause}
     ORDER BY e.date DESC, e.created_at DESC, e.id DESC
     LIMIT $2 OFFSET $3`,
    params
  );
  return result.rows;
}

async function update(id, userId, {
  merchant, amount, date, categoryId, notes,
  paymentMethod, cardLast4, cardLabel, isPrivate, excludeFromBudget, budgetExclusionReason,
  categorySource, categoryConfidence, categoryReasoning,
  placeName, address, mapkitStableId,
  locationProviderId, locationLatitude, locationLongitude, locationSource,
  locationStatus, locationConfidence, locationUserOwned,
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
  const hasCategorySource = categorySource !== undefined;
  const hasCategoryConfidence = categoryConfidence !== undefined;
  const hasCategoryReasoning = categoryReasoning !== undefined;
  const hasPlaceName = placeName !== undefined;
  const hasAddress = address !== undefined;
  const hasMapkitStableId = mapkitStableId !== undefined;
  const hasLocationProviderId = locationProviderId !== undefined;
  const hasLocationLatitude = locationLatitude !== undefined;
  const hasLocationLongitude = locationLongitude !== undefined;
  const hasLocationSource = locationSource !== undefined;
  const hasLocationStatus = locationStatus !== undefined;
  const hasLocationConfidence = locationConfidence !== undefined;
  const hasLocationUserOwned = locationUserOwned !== undefined;
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
         category_source = CASE WHEN $25 THEN $26 ELSE category_source END,
         category_confidence = CASE WHEN $27 THEN $28 ELSE category_confidence END,
         category_reasoning = CASE WHEN $29 THEN $30 ELSE category_reasoning END,
         place_name = CASE WHEN $31 THEN $32 ELSE place_name END,
         address = CASE WHEN $33 THEN $34 ELSE address END,
         mapkit_stable_id = CASE WHEN $35 THEN $36 ELSE mapkit_stable_id END,
         location_provider_id = CASE WHEN $37 THEN $38 ELSE location_provider_id END,
         location_latitude = CASE WHEN $39 THEN $40 ELSE location_latitude END,
         location_longitude = CASE WHEN $41 THEN $42 ELSE location_longitude END,
         location_source = CASE WHEN $43 THEN $44 ELSE location_source END,
         location_status = CASE WHEN $45 THEN $46 ELSE location_status END,
         location_confidence = CASE WHEN $47 THEN $48 ELSE location_confidence END,
         location_user_owned = CASE WHEN $49 THEN $50 ELSE location_user_owned END
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
        hasCategorySource, categorySource,
        hasCategoryConfidence, categoryConfidence,
        hasCategoryReasoning, categoryReasoning ? JSON.stringify(categoryReasoning) : null,
        hasPlaceName, placeName,
        hasAddress, address,
        hasMapkitStableId, mapkitStableId,
        hasLocationProviderId, locationProviderId,
        hasLocationLatitude, locationLatitude,
        hasLocationLongitude, locationLongitude,
        hasLocationSource, locationSource,
        hasLocationStatus, locationStatus,
        hasLocationConfidence, locationConfidence,
        hasLocationUserOwned, locationUserOwned,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (
      !isMissingExcludeFromBudgetError(err)
      && !isMissingBudgetExclusionReasonError(err)
      && !isMissingCategoryProvenanceError(err)
      && !isMissingLocationProvenanceError(err)
    ) throw err;
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

async function applyDeferredCategory(id, userId, {
  categoryId,
  categorySource = null,
  categoryConfidence = null,
  categoryReasoning = null,
} = {}) {
  if (!id || !userId || !categoryId) return null;

  try {
    const result = await db.query(
      `UPDATE expenses
       SET category_id = $3,
           category_source = $4,
           category_confidence = $5,
           category_reasoning = $6
       WHERE id = $1
         AND user_id = $2
         AND category_id IS NULL
       RETURNING *`,
      [
        id,
        userId,
        categoryId,
        categorySource,
        categoryConfidence,
        categoryReasoning ? JSON.stringify(categoryReasoning) : null,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingCategoryProvenanceError(err)) throw err;
    const fallback = await db.query(
      `UPDATE expenses
       SET category_id = $3
       WHERE id = $1
         AND user_id = $2
         AND category_id IS NULL
       RETURNING *`,
      [id, userId, categoryId]
    );
    return fallback.rows[0] || null;
  }
}

async function applyDeferredLocation(id, userId, {
  originalPlaceName = null,
  originalAddress = null,
  placeName = null,
  address = null,
  mapkitStableId = null,
  locationProviderId = null,
  locationLatitude = null,
  locationLongitude = null,
  locationSource = null,
  locationStatus = null,
  locationConfidence = null,
  locationUserOwned = false,
} = {}) {
  if (!id || !userId) return null;
  if (placeName == null && address == null && mapkitStableId == null && locationStatus == null) return null;

  try {
    const result = await db.query(
      `UPDATE expenses
       SET place_name = $5,
           address = $6,
           mapkit_stable_id = $7,
           location_provider_id = $8,
           location_latitude = $9,
           location_longitude = $10,
           location_source = $11,
           location_status = $12,
           location_confidence = $13,
           location_user_owned = $14
       WHERE id = $1
         AND user_id = $2
         AND mapkit_stable_id IS NULL
         AND COALESCE(place_name, '') = COALESCE($3, '')
         AND COALESCE(address, '') = COALESCE($4, '')
       RETURNING *`,
      [
        id,
        userId,
        originalPlaceName,
        originalAddress,
        placeName,
        address,
        mapkitStableId,
        locationProviderId,
        locationLatitude,
        locationLongitude,
        locationSource,
        locationStatus,
        locationConfidence,
        locationUserOwned,
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (!isMissingLocationProvenanceError(err)) throw err;
    if (placeName == null && address == null && mapkitStableId == null) return null;
    const fallback = await db.query(
      `UPDATE expenses
       SET place_name = $5,
           address = $6,
           mapkit_stable_id = $7
       WHERE id = $1
         AND user_id = $2
         AND mapkit_stable_id IS NULL
         AND COALESCE(place_name, '') = COALESCE($3, '')
         AND COALESCE(address, '') = COALESCE($4, '')
       RETURNING *`,
      [id, userId, originalPlaceName, originalAddress, placeName, address, mapkitStableId]
    );
    return fallback.rows[0] || null;
  }
}

module.exports = {
  create,
  findByUser,
  updateStatus,
  updateReviewMetadata,
  findPotentialDuplicates,
  findTreatmentCandidates,
  findByMapkitStableId,
  findById,
  findByHousehold,
  update,
  updateStatusByHousehold,
  applyDeferredCategory,
  applyDeferredLocation,
};
