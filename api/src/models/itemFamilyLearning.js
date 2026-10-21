const db = require('../db');
const { householdExpenseVisibilitySql } = require('../services/expenseAccessPolicy');

function isMissingTableError(err) {
  return err?.code === '42P01' || /item_family_(?:learning_candidates|assignments)/i.test(`${err?.message || ''}`);
}

function isMissingExcludeFromBudgetError(err) {
  return err?.code === '42703' && /exclude_from_budget/i.test(`${err?.message || ''}`);
}

async function loadCandidateGroups(householdId, requesterUserId, lookbackDays = 365, queryable = db) {
  if (!householdId || !requesterUserId) return [];
  const params = [
    householdId,
    Math.max(1, Math.min(Number(lookbackDays) || 365, 365)),
    requesterUserId,
  ];
  const buildQuery = (includeBudgetFilter) => `
    SELECT
      ei.comparable_key,
      (ARRAY_AGG(COALESCE(p.name, ei.description) ORDER BY e.date DESC))[1] AS item_name,
      COUNT(*)::int AS occurrence_count,
      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(e.merchant), '')),
        NULL
      ) AS merchants,
      c.name AS expense_category_name,
      pc.name AS parent_category_name,
      COALESCE(pc.name, c.name) AS category_group_name
    FROM expense_items ei
    JOIN expenses e ON e.id = ei.expense_id
    LEFT JOIN products p ON p.id = ei.product_id
    LEFT JOIN categories c ON c.id = e.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE e.household_id = $1
      AND ${householdExpenseVisibilitySql(3)}
      AND e.status = 'confirmed'
      ${includeBudgetFilter ? 'AND e.exclude_from_budget = FALSE' : ''}
      AND e.date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
      AND COALESCE(ei.item_type, 'product') = 'product'
      AND COALESCE(ei.extraction_confidence, 'medium') <> 'low'
      AND COALESCE(ei.product_match_reason, '') <> 'user_rejected_match'
      AND ei.comparable_key IS NOT NULL
    GROUP BY
      ei.comparable_key,
      c.name,
      pc.name,
      COALESCE(pc.name, c.name)
    ORDER BY COUNT(*) DESC, MAX(e.date) DESC
    LIMIT 1000`;

  try {
    return (await queryable.query(buildQuery(true), params)).rows;
  } catch (err) {
    if (!isMissingExcludeFromBudgetError(err)) throw err;
    return (await queryable.query(buildQuery(false), params)).rows;
  }
}

async function findAssignments(householdId, queryable = db) {
  if (!householdId) return [];
  try {
    const result = await queryable.query(
      `SELECT *
       FROM item_family_assignments
       WHERE household_id = $1
         AND active = TRUE
       ORDER BY updated_at DESC`,
      [householdId]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function saveCandidates(householdId, candidates = [], queryable = db) {
  if (!householdId || !candidates.length) return [];
  try {
    const result = await queryable.query(
      `INSERT INTO item_family_learning_candidates (
         household_id, left_item_key, right_item_key, left_label, right_label,
         suggested_family_key, suggested_family_name, family_signature,
         similarity_score, evidence
       )
       SELECT
         $1,
         candidate.left_item_key,
         candidate.right_item_key,
         candidate.left_label,
         candidate.right_label,
         candidate.suggested_family_key,
         candidate.suggested_family_name,
         candidate.family_signature,
         candidate.similarity_score,
         candidate.evidence
       FROM jsonb_to_recordset($2::jsonb) AS candidate(
         left_item_key TEXT,
         right_item_key TEXT,
         left_label TEXT,
         right_label TEXT,
         suggested_family_key TEXT,
         suggested_family_name TEXT,
         family_signature TEXT,
         similarity_score NUMERIC,
         evidence JSONB
       )
       ON CONFLICT (household_id, left_item_key, right_item_key)
       DO UPDATE SET
         left_label = EXCLUDED.left_label,
         right_label = EXCLUDED.right_label,
         suggested_family_key = EXCLUDED.suggested_family_key,
         suggested_family_name = EXCLUDED.suggested_family_name,
         family_signature = EXCLUDED.family_signature,
         similarity_score = EXCLUDED.similarity_score,
         evidence = EXCLUDED.evidence,
         updated_at = NOW()
       WHERE item_family_learning_candidates.status = 'pending'
       RETURNING *`,
      [householdId, JSON.stringify(candidates)]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function listPending(householdId, limit = 10, queryable = db) {
  if (!householdId) return [];
  try {
    const result = await queryable.query(
      `SELECT *
       FROM item_family_learning_candidates
       WHERE household_id = $1
         AND status = 'pending'
       ORDER BY similarity_score DESC, updated_at DESC
       LIMIT $2`,
      [householdId, Math.max(1, Math.min(Number(limit) || 10, 25))]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

async function reviewCandidate({ householdId, userId, candidateId, decision }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const candidateResult = await client.query(
      `SELECT *
       FROM item_family_learning_candidates
       WHERE id = $1
         AND household_id = $2
       FOR UPDATE`,
      [candidateId, householdId]
    );
    const candidate = candidateResult.rows[0] || null;
    if (!candidate) {
      await client.query('ROLLBACK');
      return null;
    }

    let familyKey = candidate.suggested_family_key;
    let familyName = candidate.suggested_family_name;
    let familySignature = candidate.family_signature;
    if (decision === 'same') {
      const existingResult = await client.query(
        `SELECT *
         FROM item_family_assignments
         WHERE household_id = $1
           AND item_key = ANY($2::text[])
           AND active = TRUE
         ORDER BY updated_at DESC`,
        [householdId, [candidate.left_item_key, candidate.right_item_key]]
      );
      const establishedFamilies = new Set(existingResult.rows.map((row) => row.family_key));
      if (establishedFamilies.size > 1) {
        const conflict = new Error('These items already belong to different confirmed families');
        conflict.code = 'ITEM_FAMILY_CONFLICT';
        throw conflict;
      }
      if (existingResult.rows[0]) {
        familyKey = existingResult.rows[0].family_key;
        familyName = existingResult.rows[0].family_name;
        familySignature = existingResult.rows[0].family_signature;
      }

      await client.query(
        `INSERT INTO item_family_assignments (
           household_id, item_key, family_key, family_name, family_signature,
           source, confidence, candidate_id, created_by
         )
         SELECT $1, item_key, $2, $3, $4, 'user_confirmed', 1, $5, $6
         FROM unnest($7::text[]) AS item_key
         ON CONFLICT (household_id, item_key)
         DO UPDATE SET
           family_key = EXCLUDED.family_key,
           family_name = EXCLUDED.family_name,
           family_signature = EXCLUDED.family_signature,
           source = 'user_confirmed',
           confidence = 1,
           candidate_id = CASE
             WHEN item_family_assignments.active
              AND item_family_assignments.family_key = EXCLUDED.family_key
             THEN item_family_assignments.candidate_id
             ELSE EXCLUDED.candidate_id
           END,
           created_by = CASE
             WHEN item_family_assignments.active
              AND item_family_assignments.family_key = EXCLUDED.family_key
             THEN item_family_assignments.created_by
             ELSE EXCLUDED.created_by
           END,
           active = TRUE,
           updated_at = NOW()`,
        [
          householdId,
          familyKey,
          familyName,
          familySignature,
          candidate.id,
          userId,
          [candidate.left_item_key, candidate.right_item_key],
        ]
      );
    } else {
      await client.query(
        `UPDATE item_family_assignments
         SET active = FALSE,
             updated_at = NOW()
         WHERE household_id = $1
           AND candidate_id = $2
           AND item_key = ANY($3::text[])`,
        [householdId, candidate.id, [candidate.left_item_key, candidate.right_item_key]]
      );
    }

    const nextStatus = decision === 'same' ? 'accepted' : decision === 'undo' ? 'pending' : 'rejected';

    const reviewedResult = await client.query(
      `UPDATE item_family_learning_candidates
       SET status = $3,
           reviewed_by = $4,
           reviewed_at = CASE WHEN $3 = 'pending' THEN NULL ELSE NOW() END,
           updated_at = NOW(),
           suggested_family_key = $5,
           suggested_family_name = $6,
           family_signature = $7
       WHERE id = $1
         AND household_id = $2
       RETURNING *`,
      [
        candidate.id,
        householdId,
        nextStatus,
        nextStatus === 'pending' ? null : userId,
        familyKey,
        familyName,
        familySignature,
      ]
    );
    await client.query('COMMIT');
    return reviewedResult.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissingTableError(err)) return null;
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findAssignments,
  isMissingTableError,
  listPending,
  loadCandidateGroups,
  reviewCandidate,
  saveCandidates,
};
