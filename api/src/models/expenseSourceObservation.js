const db = require('../db');
const {
  normalizeFieldConfidence,
  normalizeFieldEvidence,
  observedExpenseFields,
  sourceRole,
} = require('../services/importSourcePolicy');

function isMissingTableError(err) {
  return err?.code === '42P01' && `${err?.message || ''}`.includes('expense_source_observations');
}

async function record({
  userId,
  expense,
  sourceType = null,
  externalRecordId = null,
  externalTransactionId = null,
  fieldConfidence = {},
  fieldEvidence = {},
  extraFields = {},
  queryable = db,
}) {
  if (!userId || !expense?.id) return null;
  const inTransaction = queryable !== db;
  if (inTransaction) await queryable.query('SAVEPOINT expense_source_observation_compat');
  const source = sourceType || expense.source;
  const values = [
    userId,
    expense.id,
    source,
    sourceRole(source),
    externalRecordId ? `${externalRecordId}`.slice(0, 320) : null,
    externalTransactionId ? `${externalTransactionId}`.slice(0, 320) : null,
    JSON.stringify(observedExpenseFields(expense, extraFields)),
    JSON.stringify(normalizeFieldConfidence(fieldConfidence)),
    JSON.stringify(normalizeFieldEvidence(fieldEvidence)),
  ];
  try {
    const result = await queryable.query(
      `INSERT INTO expense_source_observations (
         user_id, expense_id, source_type, source_role,
         external_record_id, external_transaction_id, observed_fields,
         field_confidence, field_evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
       ON CONFLICT (user_id, source_type, external_record_id)
         WHERE external_record_id IS NOT NULL
       DO UPDATE SET
         expense_id = EXCLUDED.expense_id,
         external_transaction_id = COALESCE(EXCLUDED.external_transaction_id, expense_source_observations.external_transaction_id),
         observed_fields = EXCLUDED.observed_fields,
         field_confidence = EXCLUDED.field_confidence,
         field_evidence = EXCLUDED.field_evidence,
         updated_at = NOW()
       RETURNING *`,
      values
    );
    if (inTransaction) await queryable.query('RELEASE SAVEPOINT expense_source_observation_compat');
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      if (inTransaction) {
        await queryable.query('ROLLBACK TO SAVEPOINT expense_source_observation_compat');
        await queryable.query('RELEASE SAVEPOINT expense_source_observation_compat');
      }
      return null;
    }
    throw err;
  }
}

async function transfer({ fromExpenseId, toExpenseId, userId, queryable = db }) {
  const inTransaction = queryable !== db;
  if (inTransaction) await queryable.query('SAVEPOINT expense_source_transfer_compat');
  try {
    const result = await queryable.query(
      `UPDATE expense_source_observations
       SET expense_id = $2, updated_at = NOW()
       WHERE expense_id = $1 AND user_id = $3
       RETURNING id`,
      [fromExpenseId, toExpenseId, userId]
    );
    if (inTransaction) await queryable.query('RELEASE SAVEPOINT expense_source_transfer_compat');
    return result.rows.map((row) => row.id);
  } catch (err) {
    if (isMissingTableError(err)) {
      if (inTransaction) {
        await queryable.query('ROLLBACK TO SAVEPOINT expense_source_transfer_compat');
        await queryable.query('RELEASE SAVEPOINT expense_source_transfer_compat');
      }
      return [];
    }
    throw err;
  }
}

async function restore({ observationIds = [], fromExpenseId, toExpenseId, userId, queryable = db }) {
  const ids = observationIds.filter(Boolean);
  if (!ids.length) return 0;
  const inTransaction = queryable !== db;
  if (inTransaction) await queryable.query('SAVEPOINT expense_source_restore_compat');
  try {
    const result = await queryable.query(
      `UPDATE expense_source_observations
       SET expense_id = $2, updated_at = NOW()
       WHERE expense_id = $1 AND user_id = $3 AND id = ANY($4::uuid[])`,
      [fromExpenseId, toExpenseId, userId, ids]
    );
    if (inTransaction) await queryable.query('RELEASE SAVEPOINT expense_source_restore_compat');
    return result.rowCount || 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      if (inTransaction) {
        await queryable.query('ROLLBACK TO SAVEPOINT expense_source_restore_compat');
        await queryable.query('RELEASE SAVEPOINT expense_source_restore_compat');
      }
      return 0;
    }
    throw err;
  }
}

module.exports = { isMissingTableError, record, restore, transfer };
