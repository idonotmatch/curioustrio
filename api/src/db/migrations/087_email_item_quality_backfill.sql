BEGIN;

-- Recover unit prices that are directly implied by a line total and quantity.
UPDATE expense_items ei
SET unit_price = ROUND((ABS(ei.amount) / ei.quantity)::numeric, 4)
FROM expenses e
WHERE e.id = ei.expense_id
  AND e.source = 'email'
  AND ei.amount IS NOT NULL
  AND ei.quantity IS NOT NULL
  AND ei.quantity > 0
  AND ei.unit_price IS NULL
  AND COALESCE(ei.extraction_confidence, 'medium') <> 'high';

-- Keep uncertain legacy email rows visible for review, but out of item intelligence.
UPDATE expense_items ei
SET extraction_confidence = 'low'
FROM expenses e
WHERE e.id = ei.expense_id
  AND e.source = 'email'
  AND COALESCE(ei.extraction_confidence, 'medium') <> 'high'
  AND (
    ei.amount IS NULL
    OR COALESCE(ei.item_type, 'product') = 'summary'
    OR (
      ei.quantity IS NOT NULL
      AND ei.quantity > 0
      AND ei.unit_price IS NOT NULL
      AND ABS(ABS(ei.amount) - (ei.quantity * ei.unit_price))
        > GREATEST(0.05, ABS(ei.amount) * 0.01)
    )
  );

COMMIT;
