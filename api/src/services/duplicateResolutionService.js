const db = require('../db');
const Expense = require('../models/expense');
const EmailImportLog = require('../models/emailImportLog');
const {
  handleApprovedExpenseReview,
  handleDismissedExpenseReview,
  normalizeApprovedEmailNotes,
} = require('./expenseEmailReviewService');

const ACTION_STATUS = {
  keep_both: 'kept_both',
  keep_existing: 'dismissed',
  keep_new: 'replaced',
  merge_existing: 'merged',
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function canViewCounterpart(user, expense) {
  if (expense.user_id === user.id) return true;
  return Boolean(user.household_id && expense.household_id === user.household_id && expense.is_private !== true);
}

function sourceForValue(existingValue, importedValue, { unknown = false } = {}) {
  const existingBlank = existingValue == null || `${existingValue}`.trim() === '' || (unknown && existingValue === 'unknown');
  const importedPresent = importedValue != null && `${importedValue}`.trim() !== '' && (!unknown || importedValue !== 'unknown');
  if (!existingBlank) return 'existing';
  return importedPresent ? 'imported' : 'none';
}

function buildMergeFieldSources(existing, imported, { existingItemCount = 0, importedItemCount = 0 } = {}) {
  return {
    identity: 'existing',
    merchant: 'existing',
    amount: 'existing',
    date: 'existing',
    source: 'existing',
    description: sourceForValue(existing.description, imported.description),
    category: sourceForValue(existing.category_id, imported.category_id),
    notes: sourceForValue(existing.notes, imported.notes),
    payment_method: sourceForValue(existing.payment_method, imported.payment_method, { unknown: true }),
    card_last4: sourceForValue(existing.card_last4, imported.card_last4),
    card_label: sourceForValue(existing.card_label, imported.card_label),
    place_name: sourceForValue(existing.place_name, imported.place_name),
    address: sourceForValue(existing.address, imported.address),
    mapkit_stable_id: sourceForValue(existing.mapkit_stable_id, imported.mapkit_stable_id),
    location_provider_id: sourceForValue(existing.location_provider_id, imported.location_provider_id),
    location_latitude: sourceForValue(existing.location_latitude, imported.location_latitude),
    location_longitude: sourceForValue(existing.location_longitude, imported.location_longitude),
    location_source: sourceForValue(existing.location_source, imported.location_source),
    location_status: sourceForValue(existing.location_status, imported.location_status),
    location_confidence: sourceForValue(existing.location_confidence, imported.location_confidence),
    location_user_owned: 'existing',
    is_private: 'existing',
    budget_treatment: 'existing',
    items: existingItemCount > 0 ? 'existing' : importedItemCount > 0 ? 'imported' : 'none',
  };
}

async function resolveDuplicate({ user, expenseId, flagId, action }) {
  const nextFlagStatus = ACTION_STATUS[action];
  if (!nextFlagStatus) throw httpError(400, 'Invalid duplicate resolution action');

  const client = await db.pool.connect();
  let current;
  let counterpart;
  let currentWasPending = false;
  let counterpartWasPending = false;
  let currentConfirmed = false;
  let mergeSummary = null;
  let flag;

  try {
    await client.query('BEGIN');
    const flagResult = await client.query(
      'SELECT * FROM duplicate_flags WHERE id = $1 FOR UPDATE',
      [flagId]
    );
    flag = flagResult.rows[0];
    if (!flag || ![flag.expense_id_a, flag.expense_id_b].includes(expenseId)) {
      throw httpError(404, 'Duplicate match not found');
    }

    const expenseResult = await client.query(
      'SELECT * FROM expenses WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [[flag.expense_id_a, flag.expense_id_b]]
    );
    current = expenseResult.rows.find((row) => row.id === expenseId);
    counterpart = expenseResult.rows.find((row) => row.id !== expenseId);
    if (!current || current.user_id !== user.id || !counterpart || !canViewCounterpart(user, counterpart)) {
      throw httpError(404, 'Duplicate match not found');
    }
    if (action === 'keep_new' && counterpart.user_id !== user.id) {
      throw httpError(403, 'You cannot dismiss another household member\'s expense');
    }
    if (action === 'merge_existing') {
      if (counterpart.user_id !== user.id) {
        throw httpError(403, 'You cannot merge into another household member\'s expense');
      }
      if (current.source !== 'email' || counterpart.source !== 'manual') {
        throw httpError(400, 'Only an imported expense can be merged into a manual expense');
      }
    }

    if (flag.status !== 'pending') {
      if (flag.status !== nextFlagStatus) throw httpError(409, 'This duplicate match was already resolved');
      await client.query('COMMIT');
      const replayExpense = action === 'merge_existing' ? counterpart : current;
      return {
        action,
        expense: replayExpense,
        duplicate_flag: flag,
        dismissed_expense_id: action === 'merge_existing' ? current.id : null,
        surviving_expense_id: replayExpense.id,
        merge_summary: null,
        idempotent_replay: true,
      };
    }

    currentWasPending = current.status === 'pending';
    counterpartWasPending = counterpart.status === 'pending';

    if (action === 'merge_existing') {
      const itemCounts = await client.query(
        `SELECT expense_id, COUNT(*)::int AS count
         FROM expense_items
         WHERE expense_id = ANY($1::uuid[])
         GROUP BY expense_id`,
        [[current.id, counterpart.id]]
      );
      const countByExpense = new Map(itemCounts.rows.map((row) => [row.expense_id, Number(row.count || 0)]));
      const importedItemCount = countByExpense.get(current.id) || 0;
      const existingItemCount = countByExpense.get(counterpart.id) || 0;
      const fieldSources = buildMergeFieldSources(counterpart, current, { existingItemCount, importedItemCount });
      const importedNotes = normalizeApprovedEmailNotes(current.notes || '') || null;

      const merged = await client.query(
        `UPDATE expenses existing
         SET description = COALESCE(NULLIF(BTRIM(existing.description), ''), imported.description),
             category_id = COALESCE(existing.category_id, imported.category_id),
             notes = COALESCE(NULLIF(BTRIM(existing.notes), ''), $4),
             place_name = COALESCE(NULLIF(BTRIM(existing.place_name), ''), imported.place_name),
             address = COALESCE(NULLIF(BTRIM(existing.address), ''), imported.address),
             mapkit_stable_id = COALESCE(NULLIF(BTRIM(existing.mapkit_stable_id), ''), imported.mapkit_stable_id),
             location_provider_id = COALESCE(NULLIF(BTRIM(existing.location_provider_id), ''), imported.location_provider_id),
             location_latitude = COALESCE(existing.location_latitude, imported.location_latitude),
             location_longitude = COALESCE(existing.location_longitude, imported.location_longitude),
             location_source = COALESCE(NULLIF(BTRIM(existing.location_source), ''), imported.location_source),
             location_status = COALESCE(NULLIF(BTRIM(existing.location_status), ''), imported.location_status),
             location_confidence = COALESCE(existing.location_confidence, imported.location_confidence),
             payment_method = CASE
               WHEN existing.payment_method IS NULL OR existing.payment_method = 'unknown'
                 THEN COALESCE(NULLIF(imported.payment_method, 'unknown'), existing.payment_method)
               ELSE existing.payment_method
             END,
             card_last4 = COALESCE(NULLIF(BTRIM(existing.card_last4), ''), imported.card_last4),
             card_label = COALESCE(NULLIF(BTRIM(existing.card_label), ''), imported.card_label),
             category_source = CASE WHEN existing.category_id IS NULL THEN imported.category_source ELSE existing.category_source END,
             category_confidence = CASE WHEN existing.category_id IS NULL THEN imported.category_confidence ELSE existing.category_confidence END,
             category_reasoning = CASE WHEN existing.category_id IS NULL THEN imported.category_reasoning ELSE existing.category_reasoning END
         FROM expenses imported
         WHERE existing.id = $1
           AND existing.user_id = $2
           AND imported.id = $3
         RETURNING existing.*`,
        [counterpart.id, user.id, current.id, importedNotes]
      );
      counterpart = merged.rows[0];
      if (!counterpart) throw httpError(409, 'Could not merge these expenses');

      let transferredItems = 0;
      if (existingItemCount === 0 && importedItemCount > 0) {
        const transferred = await client.query(
          'UPDATE expense_items SET expense_id = $1 WHERE expense_id = $2 RETURNING id',
          [counterpart.id, current.id]
        );
        transferredItems = transferred.rowCount || transferred.rows.length;
      }

      const dismissed = await client.query(
        `UPDATE expenses
         SET status = 'dismissed',
             review_required = FALSE,
             linked_expense_id = $3
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [current.id, user.id, counterpart.id]
      );
      current = dismissed.rows[0];
      await client.query(
        'UPDATE email_import_log SET expense_id = $1 WHERE expense_id = $2 AND user_id = $3',
        [counterpart.id, current.id, user.id]
      );
      mergeSummary = { survivor: counterpart, field_sources: fieldSources, imported_items_count: transferredItems };
    } else if (action === 'keep_existing') {
      const updated = await client.query(
        `UPDATE expenses SET status = 'dismissed' WHERE id = $1 AND user_id = $2 RETURNING *`,
        [current.id, user.id]
      );
      current = updated.rows[0];
    } else if (action === 'keep_new') {
      const dismissed = await client.query(
        `UPDATE expenses SET status = 'dismissed' WHERE id = $1 AND user_id = $2 RETURNING *`,
        [counterpart.id, user.id]
      );
      counterpart = dismissed.rows[0];
    }

    const resolved = await client.query(
      `UPDATE duplicate_flags
       SET status = $2, resolved_by = $3, resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [flag.id, nextFlagStatus, user.id]
    );
    flag = resolved.rows[0];

    if (action === 'merge_existing') {
      await client.query(
        `UPDATE duplicate_flags
         SET status = 'merged', resolved_by = $2, resolved_at = NOW()
         WHERE id <> $1
           AND status = 'pending'
           AND (expense_id_a = $3 OR expense_id_b = $3)`,
        [flag.id, user.id, current.id]
      );
      await client.query(
        `INSERT INTO expense_merge_events (
           user_id, surviving_expense_id, merged_expense_id, duplicate_flag_id,
           field_sources, imported_items_count
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [user.id, counterpart.id, current.id, flag.id, JSON.stringify(mergeSummary.field_sources), mergeSummary.imported_items_count]
      );
    }

    if (action === 'keep_existing') {
      await client.query(
        `UPDATE duplicate_flags
         SET status = 'dismissed', resolved_by = $2, resolved_at = NOW()
         WHERE id <> $1
           AND status = 'pending'
           AND (expense_id_a = $3 OR expense_id_b = $3)`,
        [flag.id, user.id, current.id]
      );
    } else if (action === 'keep_new') {
      await client.query(
        `UPDATE duplicate_flags
         SET status = 'replaced', resolved_by = $2, resolved_at = NOW()
         WHERE id <> $1
           AND status = 'pending'
           AND (expense_id_a = $3 OR expense_id_b = $3)`,
        [flag.id, user.id, counterpart.id]
      );
      if (currentWasPending) {
        const remaining = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM duplicate_flags
           WHERE status = 'pending'
             AND (expense_id_a = $1 OR expense_id_b = $1)`,
          [current.id]
        );
        if (Number(remaining.rows[0]?.count || 0) === 0) {
          const confirmed = await client.query(
            `UPDATE expenses SET status = 'confirmed' WHERE id = $1 AND user_id = $2 RETURNING *`,
            [current.id, user.id]
          );
          current = confirmed.rows[0];
          currentConfirmed = true;
        }
      }
    } else if (action === 'keep_both' && currentWasPending) {
      const remaining = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM duplicate_flags
         WHERE status = 'pending'
           AND (expense_id_a = $1 OR expense_id_b = $1)`,
        [current.id]
      );
      if (Number(remaining.rows[0]?.count || 0) === 0) {
        const confirmed = await client.query(
          `UPDATE expenses SET status = 'confirmed' WHERE id = $1 AND user_id = $2 RETURNING *`,
          [current.id, user.id]
        );
        current = confirmed.rows[0];
        currentConfirmed = true;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (action === 'merge_existing') {
    try {
      await EmailImportLog.recordReviewFeedback(counterpart.id, {
        action: 'approved',
        changedFields: ['merged_into_existing'],
      });
    } catch (err) {
      console.error('[duplicate merge] import feedback failed:', err?.message || err);
    }
  } else if (action === 'keep_existing') {
    current = await handleDismissedExpenseReview(current, user.id, 'duplicate');
  } else if (action === 'keep_new') {
    if (currentConfirmed) current = await handleApprovedExpenseReview(current, user.id, 'full_review');
    if (counterpartWasPending) {
      counterpart = await handleDismissedExpenseReview(counterpart, user.id, 'duplicate');
    }
  } else if (action === 'keep_both' && currentConfirmed) {
    current = await handleApprovedExpenseReview(current, user.id, 'full_review');
  }

  const resultExpense = action === 'merge_existing' ? counterpart : current;
  const refreshedExpense = await Expense.findById(resultExpense.id) || resultExpense;
  return {
    action,
    expense: refreshedExpense,
    duplicate_flag: flag,
    dismissed_expense_id: action === 'merge_existing'
      ? current.id
      : action === 'keep_existing'
      ? current.id
      : action === 'keep_new' ? counterpart.id : null,
    surviving_expense_id: action === 'merge_existing' ? counterpart.id : refreshedExpense.id,
    merge_summary: action === 'merge_existing' ? mergeSummary : null,
    idempotent_replay: false,
  };
}

module.exports = { resolveDuplicate, ACTION_STATUS, buildMergeFieldSources };
