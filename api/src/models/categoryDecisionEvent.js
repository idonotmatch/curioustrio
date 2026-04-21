const db = require('../db');

function normalizeText(value = '') {
  return `${value || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function create({
  userId,
  householdId = null,
  expenseId = null,
  eventType,
  merchantName = null,
  description = null,
  suggestedCategoryId = null,
  previousCategoryId = null,
  finalCategoryId = null,
  suggestionSource = null,
  suggestionConfidence = null,
} = {}) {
  if (!userId || !eventType) return null;
  if (!suggestedCategoryId && !previousCategoryId && !finalCategoryId) return null;

  const result = await db.query(
    `INSERT INTO category_decision_events (
       user_id, household_id, expense_id, event_type, merchant_name, description,
       suggested_category_id, previous_category_id, final_category_id,
       suggestion_source, suggestion_confidence
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, user_id, household_id, expense_id, event_type, merchant_name, description,
               suggested_category_id, previous_category_id, final_category_id,
               suggestion_source, suggestion_confidence, created_at`,
    [
      userId,
      householdId,
      expenseId,
      eventType,
      merchantName,
      description,
      suggestedCategoryId,
      previousCategoryId,
      finalCategoryId,
      suggestionSource,
      suggestionConfidence == null ? null : Number(suggestionConfidence),
    ]
  );
  return result.rows[0] || null;
}

async function findBestLearnedMatch({
  householdId,
  merchantName = null,
  description = null,
} = {}) {
  if (!householdId) return null;

  const normalizedMerchant = normalizeText(merchantName);
  const normalizedDescription = normalizeText(description);

  if (normalizedMerchant && normalizedDescription) {
    const exactResult = await db.query(
      `SELECT final_category_id AS category_id,
              COUNT(*)::int AS decision_count,
              MAX(created_at) AS last_used_at
       FROM category_decision_events
       WHERE household_id = $1
         AND final_category_id IS NOT NULL
         AND LOWER(TRIM(COALESCE(merchant_name, ''))) = $2
         AND LOWER(TRIM(COALESCE(description, ''))) = $3
       GROUP BY final_category_id
       ORDER BY COUNT(*) DESC, MAX(created_at) DESC
       LIMIT 1`,
      [householdId, normalizedMerchant, normalizedDescription]
    );
    if (exactResult.rows[0]) {
      return {
        category_id: exactResult.rows[0].category_id,
        decision_count: Number(exactResult.rows[0].decision_count || 0),
        match_type: 'merchant_description',
      };
    }
  }

  if (normalizedDescription) {
    const descriptionResult = await db.query(
      `SELECT final_category_id AS category_id,
              COUNT(*)::int AS decision_count,
              MAX(created_at) AS last_used_at
       FROM category_decision_events
       WHERE household_id = $1
         AND final_category_id IS NOT NULL
         AND LOWER(TRIM(COALESCE(description, ''))) = $2
       GROUP BY final_category_id
       ORDER BY COUNT(*) DESC, MAX(created_at) DESC
       LIMIT 1`,
      [householdId, normalizedDescription]
    );
    if (descriptionResult.rows[0]) {
      return {
        category_id: descriptionResult.rows[0].category_id,
        decision_count: Number(descriptionResult.rows[0].decision_count || 0),
        match_type: 'description',
      };
    }
  }

  return null;
}

module.exports = {
  create,
  findBestLearnedMatch,
};
