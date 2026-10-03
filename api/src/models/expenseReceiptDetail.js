const db = require('../db');

function isMissingTableError(err) {
  return err?.code === '42P01' && `${err?.message || ''}`.includes('expense_receipt_details');
}

function boundedText(value, maxLength) {
  const text = `${value || ''}`.trim();
  return text ? text.slice(0, maxLength) : null;
}

function boundedAmount(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount) <= 1_000_000_000 ? amount : null;
}

function normalizeValidation(validation = {}) {
  const allowedIssues = ['total_components_mismatch', 'item_sum_mismatch'];
  const allowedFields = ['merchant', 'amount', 'date', 'items', 'payment_method'];
  const confidenceValues = new Set(['low', 'medium', 'high']);
  const fieldConfidence = Object.fromEntries(
    Object.entries(validation.field_confidence || {})
      .filter(([key, value]) => allowedFields.includes(key) && confidenceValues.has(value))
  );
  return {
    total_components_match: typeof validation.total_components_match === 'boolean' ? validation.total_components_match : null,
    item_sum_matches_subtotal: typeof validation.item_sum_matches_subtotal === 'boolean' ? validation.item_sum_matches_subtotal : null,
    issues: Array.isArray(validation.issues) ? validation.issues.filter((value) => allowedIssues.includes(value)) : [],
    uncertain_fields: Array.isArray(validation.uncertain_fields)
      ? validation.uncertain_fields.filter((value) => allowedFields.includes(value))
      : [],
    field_confidence: fieldConfidence,
  };
}

function normalizeDetails(details = {}) {
  const currency = `${details.currency || ''}`.trim().toUpperCase();
  const purchaseTime = `${details.purchase_time || ''}`.trim();
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    subtotal: boundedAmount(details.subtotal),
    tax: boundedAmount(details.tax),
    tip: boundedAmount(details.tip),
    fees: boundedAmount(details.fees),
    discounts: boundedAmount(details.discounts),
    transaction_id: boundedText(details.transaction_id, 160),
    purchase_time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(purchaseTime) ? purchaseTime : null,
    store_number: boundedText(details.store_number, 80),
    validation: normalizeValidation(details.validation),
  };
}

async function upsert(expenseId, details = {}) {
  if (!expenseId || !details || typeof details !== 'object') return null;
  const normalized = normalizeDetails(details);
  try {
    const result = await db.query(
      `INSERT INTO expense_receipt_details (
         expense_id, currency, subtotal, tax, tip, fees, discounts,
         transaction_id, purchase_time, store_number, validation
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (expense_id) DO UPDATE SET
         currency = EXCLUDED.currency,
         subtotal = EXCLUDED.subtotal,
         tax = EXCLUDED.tax,
         tip = EXCLUDED.tip,
         fees = EXCLUDED.fees,
         discounts = EXCLUDED.discounts,
         transaction_id = EXCLUDED.transaction_id,
         purchase_time = EXCLUDED.purchase_time,
         store_number = EXCLUDED.store_number,
         validation = EXCLUDED.validation,
         updated_at = NOW()
       RETURNING *`,
      [
        expenseId,
        normalized.currency,
        normalized.subtotal,
        normalized.tax,
        normalized.tip,
        normalized.fees,
        normalized.discounts,
        normalized.transaction_id,
        normalized.purchase_time,
        normalized.store_number,
        JSON.stringify(normalized.validation),
      ]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function findPotentialDuplicates({ householdId, userId, transactionId, date, excludeId }) {
  if ((!householdId && !userId) || !transactionId) return [];
  try {
    const result = await db.query(
      `SELECT e.*
       FROM expense_receipt_details rd
       JOIN expenses e ON e.id = rd.expense_id
       WHERE LOWER(rd.transaction_id) = LOWER($1)
         AND e.id <> $2
         AND e.status = 'confirmed'
         AND e.date BETWEEN $3::date - INTERVAL '3 days' AND $3::date + INTERVAL '3 days'
         AND (($4::uuid IS NOT NULL AND e.household_id = $4)
           OR ($4::uuid IS NULL AND e.user_id = $5))
       ORDER BY e.date DESC
       LIMIT 10`,
      [transactionId, excludeId, date, householdId, userId]
    );
    return result.rows;
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

module.exports = { upsert, findPotentialDuplicates, normalizeDetails };
