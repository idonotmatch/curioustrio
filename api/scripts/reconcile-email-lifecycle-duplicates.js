const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../src/db');
const {
  classifyLifecycleEvent,
  extractOrderId,
  isNonFinancialLifecycleEvent,
} = require('../src/services/emailTransactionLifecycle');
const { extractSenderRootDomain } = require('../src/services/gmailImportFingerprint');

const MARKER = 'lifecycle_duplicate_reconciled';
const FINANCIAL_EVENTS = new Set(['purchase_confirmation', 'charge']);

function merchantKey(value = '') {
  return `${value || ''}`.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function daysBetween(left, right) {
  const parseDate = (value) => {
    const raw = value instanceof Date ? value.toISOString() : `${value || ''}`;
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) return new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00Z`);
    return new Date(raw);
  };
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return Infinity;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86400000;
}

function eventType(row) {
  const classified = classifyLifecycleEvent(row.subject || '', '', {});
  return classified === 'unknown' ? `${row.email_event_type || 'unknown'}` : classified;
}

function rootDomain(row) {
  return row.sender_root_domain
    || extractSenderRootDomain(row.from_address || row.sender_domain || '');
}

function orderIdsMatch(left, right) {
  const leftId = left.external_order_id || extractOrderId(left.subject || '');
  const rightId = right.external_order_id || extractOrderId(right.subject || '');
  if (!leftId || !rightId) return false;
  if (leftId === rightId) return true;
  if (leftId.startsWith('ENDING-')) return rightId.endsWith(leftId.slice(7));
  if (rightId.startsWith('ENDING-')) return leftId.endsWith(rightId.slice(7));
  return false;
}

function pairEvidence(left, right) {
  if (left.user_id !== right.user_id || left.expense_id === right.expense_id) return null;
  if (!merchantKey(left.merchant) || merchantKey(left.merchant) !== merchantKey(right.merchant)) return null;
  const leftRoot = rootDomain(left);
  const rightRoot = rootDomain(right);
  if (!leftRoot || leftRoot === 'unknown' || leftRoot !== rightRoot) return null;

  const leftAmount = Math.abs(Number(left.amount || 0));
  const rightAmount = Math.abs(Number(right.amount || 0));
  if (!leftAmount || !rightAmount) return null;
  const dateDistance = daysBetween(left.date, right.date);
  if (dateDistance > 14) return null;

  const leftEvent = eventType(left);
  const rightEvent = eventType(right);
  const leftFinancial = FINANCIAL_EVENTS.has(leftEvent);
  const rightFinancial = FINANCIAL_EVENTS.has(rightEvent);
  const complementary = new Set([leftEvent, rightEvent]);
  const exactIdentity = (
    left.external_transaction_id && left.external_transaction_id === right.external_transaction_id
  ) || orderIdsMatch(left, right) || (
    left.gmail_thread_id && left.gmail_thread_id === right.gmail_thread_id
  );
  const fulfillmentPair = (
    (isNonFinancialLifecycleEvent(leftEvent) && rightFinancial)
    || (isNonFinancialLifecycleEvent(rightEvent) && leftFinancial)
  );
  const amountDifference = Math.abs(leftAmount - rightAmount);
  const amountNear = amountDifference <= Math.max(1, Math.max(leftAmount, rightAmount) * 0.03);
  const amountExact = amountDifference <= Math.max(0.05, Math.max(leftAmount, rightAmount) * 0.01);
  const complementaryFinancial = complementary.has('purchase_confirmation')
    && complementary.has('charge')
    && amountExact
    && dateDistance <= 3;

  const meaningfulExactIdentity = exactIdentity && (leftFinancial || rightFinancial);
  if (!meaningfulExactIdentity && !(fulfillmentPair && amountNear && dateDistance <= 7) && !complementaryFinancial) return null;
  return {
    leftEvent,
    rightEvent,
    reason: exactIdentity
      ? 'exact_identity'
      : (fulfillmentPair ? 'fulfillment_sibling' : 'confirmation_charge_pair'),
  };
}

function canonicalScore(row, type) {
  let score = 0;
  if (row.status === 'confirmed') score += 100;
  if (FINANCIAL_EVENTS.has(type)) score += 50;
  score += Math.min(Number(row.item_count || 0), 20);
  return score;
}

function selectReconciliations(rows = []) {
  const selections = new Map();
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      const evidence = pairEvidence(left, right);
      if (!evidence) continue;

      const leftScore = canonicalScore(left, evidence.leftEvent);
      const rightScore = canonicalScore(right, evidence.rightEvent);
      const canonical = leftScore === rightScore
        ? (new Date(left.created_at) <= new Date(right.created_at) ? left : right)
        : (leftScore > rightScore ? left : right);
      const duplicate = canonical.expense_id === left.expense_id ? right : left;
      if (duplicate.status !== 'pending') continue;

      const existing = selections.get(duplicate.expense_id);
      if (!existing || canonicalScore(canonical, eventType(canonical)) > existing.canonical_score) {
        selections.set(duplicate.expense_id, {
          duplicate_expense_id: duplicate.expense_id,
          duplicate_log_id: duplicate.log_id,
          canonical_expense_id: canonical.expense_id,
          canonical_score: canonicalScore(canonical, eventType(canonical)),
          merchant: duplicate.merchant,
          amount: Number(duplicate.amount),
          duplicate_subject: duplicate.subject,
          canonical_subject: canonical.subject,
          reason: evidence.reason,
        });
      }
    }
  }
  return [...selections.values()];
}

async function findRows() {
  const result = await db.query(
    `SELECT DISTINCT ON (e.id)
            e.user_id,
            e.id AS expense_id,
            e.status,
            e.merchant,
            e.amount,
            e.date,
            e.created_at,
            l.id AS log_id,
            l.subject,
            l.from_address,
            l.sender_domain,
            l.sender_root_domain,
            l.email_event_type,
            l.external_order_id,
            l.external_transaction_id,
            l.gmail_thread_id,
            l.purchase_identity_key,
            (SELECT COUNT(*)::int FROM expense_items i WHERE i.expense_id = e.id) AS item_count
     FROM expenses e
     JOIN email_import_log l ON l.expense_id = e.id
     WHERE e.source = 'email'
       AND e.status IN ('pending', 'confirmed')
       AND l.status = 'imported'
       AND COALESCE(l.skip_reason, '') <> $1
     ORDER BY e.id, l.imported_at DESC`,
    [MARKER]
  );
  return result.rows;
}

async function applyReconciliations(selections) {
  if (!selections.length) return 0;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let updated = 0;
    for (const selection of selections) {
      const expenseResult = await client.query(
        `UPDATE expenses
         SET status = 'dismissed', review_required = FALSE
         WHERE id = $1 AND status = 'pending' AND source = 'email'
         RETURNING id`,
        [selection.duplicate_expense_id]
      );
      if (!expenseResult.rowCount) continue;
      updated += expenseResult.rowCount;
      await client.query(
        `UPDATE email_import_log
         SET skip_reason = $2,
             related_expense_id = $3,
             lifecycle_match_confidence = 'high',
             lifecycle_match_reason = $4
         WHERE id = $1`,
        [
          selection.duplicate_log_id,
          MARKER,
          selection.canonical_expense_id,
          selection.reason,
        ]
      );
    }
    await client.query('COMMIT');
    return updated;
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
       SET skip_reason = NULL,
           related_expense_id = NULL,
           lifecycle_match_confidence = NULL,
           lifecycle_match_reason = NULL
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

async function main() {
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : (process.argv.includes('--restore') ? 'restore' : 'preview');
  if (mode === 'restore') {
    console.log(JSON.stringify({ mode, restored: await restore() }, null, 2));
    return;
  }

  const selections = selectReconciliations(await findRows());
  const result = { mode, candidate_count: selections.length, candidates: selections };
  if (mode === 'apply') result.reconciled = await applyReconciliations(selections);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('[reconcile-email-lifecycle-duplicates]', err?.message || err);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  pairEvidence,
  selectReconciliations,
};
