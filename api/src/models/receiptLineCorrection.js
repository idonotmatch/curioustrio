const db = require('../db');

async function upsert({
  householdId,
  merchant,
  rawLabel,
  correctedLabel,
  productId = null,
}) {
  if (!householdId || !merchant || !rawLabel || !correctedLabel) return null;

  const result = await db.query(
    `INSERT INTO receipt_line_corrections (
       household_id, merchant, raw_label, corrected_label, product_id
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (household_id, merchant, raw_label, corrected_label)
     DO UPDATE SET
       product_id = COALESCE(EXCLUDED.product_id, receipt_line_corrections.product_id),
       occurrence_count = receipt_line_corrections.occurrence_count + 1,
       updated_at = NOW()
     RETURNING *`,
    [householdId, merchant, rawLabel, correctedLabel, productId]
  );
  return result.rows[0] || null;
}

module.exports = { upsert };
