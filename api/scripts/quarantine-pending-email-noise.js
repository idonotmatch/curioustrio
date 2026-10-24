const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/db');
const { shouldQuarantineStoredImport } = require('../src/services/emailAdmissionPolicy');

const MARKER = 'post_import_quality_gate';

async function findCandidates() {
  const result = await db.query(
    `SELECT e.id AS expense_id,
            e.merchant,
            e.amount,
            e.created_at,
            l.id AS log_id,
            l.subject,
            l.from_address,
            l.snippet
     FROM expenses e
     JOIN email_import_log l ON l.expense_id = e.id
     WHERE e.source = 'email'
       AND e.status = 'pending'
       AND l.status = 'imported'
     ORDER BY e.created_at DESC`
  );
  return result.rows.filter(shouldQuarantineStoredImport);
}

async function quarantine(candidates) {
  if (!candidates.length) return 0;
  const expenseIds = candidates.map((row) => row.expense_id);
  const logIds = candidates.map((row) => row.log_id);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE expenses
       SET status = 'dismissed', review_required = FALSE
       WHERE id = ANY($1::uuid[])
         AND status = 'pending'
         AND source = 'email'
       RETURNING id`,
      [expenseIds]
    );
    await client.query(
      `UPDATE email_import_log
       SET skip_reason = $2
       WHERE id = ANY($1::uuid[])
         AND status = 'imported'`,
      [logIds, MARKER]
    );
    await client.query('COMMIT');
    return updated.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function restore() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const restored = await client.query(
      `UPDATE expenses e
       SET status = 'pending', review_required = TRUE
       FROM email_import_log l
       LEFT JOIN email_import_feedback f ON f.expense_id = l.expense_id
       WHERE l.expense_id = e.id
         AND l.skip_reason = $1
         AND e.status = 'dismissed'
         AND f.expense_id IS NULL
       RETURNING e.id`,
      [MARKER]
    );
    await client.query(
      `UPDATE email_import_log
       SET skip_reason = NULL
       WHERE skip_reason = $1
         AND expense_id = ANY($2::uuid[])`,
      [MARKER, restored.rows.map((row) => row.id)]
    );
    await client.query('COMMIT');
    return restored.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function preview(candidates) {
  return candidates.map((row) => ({
    expense_id: row.expense_id,
    merchant: row.merchant,
    amount: Number(row.amount),
    subject: row.subject,
    created_at: row.created_at,
  }));
}

async function main() {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : (process.argv.includes('--restore') ? 'restore' : 'preview');
  if (mode === 'restore') {
    console.log(JSON.stringify({ mode, restored: await restore() }, null, 2));
    return;
  }

  const candidates = await findCandidates();
  const result = { mode, candidate_count: candidates.length, candidates: preview(candidates) };
  if (mode === 'apply') result.quarantined = await quarantine(candidates);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('[quarantine-pending-email-noise]', err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
